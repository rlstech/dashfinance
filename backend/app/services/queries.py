"""
Queries SQL migradas de db.py — preservadas exatamente.
Todas usam placeholders parametrizados (%s).
"""
import pymssql
from datetime import datetime, timedelta
from app.services.database import get_db

EMPRESA_MAP = {1: "COMBRASEN", 3: "DRESDEN", 4: "TRUST", 5: "GAMA 01", 6: "CONSÓRCIO HMSJ"}

# Bancos a excluir por empresa (Receitas, AP e Saldo Bancário).
BLOCKED_BANCOS: dict[str, set[str]] = {
    "COMBRASEN": {"-1", "8", "196", "199", "755", "997", "998", "999"},
    "GAMA 01": {"-1", "998"},
    "TRUST": {"-1", "998"},
    "DRESDEN": {"-1", "341"},
    "CONSÓRCIO HMSJ": {"-1"},
}

# Contas específicas a excluir por empresa → banco → set de contas.
BLOCKED_CONTAS: dict[str, dict[str, set[str]]] = {
    "COMBRASEN": {
        "341": {"14632-6", "19721-2", "01557-3", "30333-1"},
        "756": {"15041-0", "10290-3"},
        "70":  {"10-1", "39248-X", "9999-9"},
        "707": {"722041-5"},
    },
}


def _is_blocked_banco(empresa: str, banco: str) -> bool:
    return banco in BLOCKED_BANCOS.get(empresa, set())


def _is_blocked_conta(empresa: str, banco: str, conta: str) -> bool:
    return conta in BLOCKED_CONTAS.get(empresa, {}).get(banco, set())

_SALDO_CONTA_COL: str | None = None
_REAJ_TABLE: str | None = None


def _get_saldo_conta_col() -> str | None:
    """Descobre o nome da coluna de conta corrente na SaldoConta."""
    with get_db() as conn:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'SaldoConta' AND COLUMN_NAME LIKE %s
            """,
            ("%onta%",),
        )
        cols = [r["COLUMN_NAME"] for r in cur.fetchall()]
    for c in cols:
        if c.lower().startswith("conta") and "banco" not in c.lower():
            return c
    return None


def _get_reaj_table() -> str | None:
    """Descobre o nome da tabela de reajuste (ReceberReajCalc_*) no banco."""
    with get_db() as conn:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """

            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME LIKE 'ReceberReajCalc%%'
            ORDER BY TABLE_NAME DESC
            """,
        )
        rows = cur.fetchall()
    return rows[0]["TABLE_NAME"] if rows else None

def get_ap(de: str = "2026-01-01", ate: str = "2026-06-30") -> list[dict]:
    sql = """
    SELECT Empresa, Obra, Data, Fornecedor, Banco, Conta, Categoria,
           SUM(Valor) AS Valor, Origem
    FROM (
        SELECT
            CASE v.Empresa_des
                WHEN 1 THEN 'COMBRASEN' WHEN 3 THEN 'DRESDEN'
                WHEN 4 THEN 'TRUST'     WHEN 5 THEN 'GAMA 01'
                WHEN 6 THEN 'CONSÓRCIO HMSJ'
                ELSE CAST(v.Empresa_des AS VARCHAR)
            END AS Empresa,
            CAST(v.Obra_des AS VARCHAR) AS Obra,
            CONVERT(VARCHAR(10), v.DtPgto_des, 103) AS Data,
            p.nome_pes AS Fornecedor,
            CAST(v.Banco_des AS VARCHAR) AS Banco,
            v.ContaCorr_des AS Conta,
            ISNULL(cmf.Desc_cmf, 'S/Categoria') AS Categoria,
            v.TotalLiq_des AS Valor,
            CASE WHEN v.StatusParc_des = 0 THEN 'A Confirmar' ELSE 'Emissao' END AS Origem
        FROM VwDesembolsoAPagar v
        LEFT JOIN Pessoas p ON p.cod_pes = v.CodForn_Des
        LEFT JOIN CategoriasDeMovFin cmf ON cmf.Codigo_cmf = v.CategMovFin_Des
        WHERE v.StatusParc_des IN (0, 1)
          AND v.DtPgto_des BETWEEN %s AND %s

        UNION ALL

        SELECT
            CASE v.Empresa_des
                WHEN 1 THEN 'COMBRASEN' WHEN 3 THEN 'DRESDEN'
                WHEN 4 THEN 'TRUST'     WHEN 5 THEN 'GAMA 01'
                WHEN 6 THEN 'CONSÓRCIO HMSJ'
                ELSE CAST(v.Empresa_des AS VARCHAR)
            END AS Empresa,
            CAST(v.Obra_des AS VARCHAR) AS Obra,
            CONVERT(VARCHAR(10), v.DtPgto_des, 103) AS Data,
            p.nome_pes AS Fornecedor,
            CAST(v.Banco_des AS VARCHAR) AS Banco,
            v.ContaCorr_des AS Conta,
            ISNULL(cmf.Desc_cmf, 'S/Categoria') AS Categoria,
            v.TotalLiq_des AS Valor,
            'Pago' AS Origem
        FROM VwDesembolsoPago v
        LEFT JOIN Pessoas p ON p.cod_pes = v.CodForn_Des
        LEFT JOIN CategoriasDeMovFin cmf ON cmf.Codigo_cmf = v.CategMovFin_Des
        WHERE v.DtPgto_des BETWEEN %s AND %s
    ) t
    GROUP BY Empresa, Obra, Data, Fornecedor, Banco, Conta, Categoria, Origem
    ORDER BY Data, Empresa, Obra
    """
    with get_db() as conn:
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, (de, ate, de, ate))
        rows = cur.fetchall()
    result = [
        {
            "empresa": r["Empresa"] or "",
            "obra": r["Obra"] or "",
            "data": r["Data"] or "",
            "fornecedor": (r["Fornecedor"] or "").strip(),
            "banco": str(r["Banco"] or "").strip(),
            "conta": str(r["Conta"] or "").strip(),
            "categoria": r["Categoria"] or "",
            "valor": float(r["Valor"] or 0),
            "origem": r["Origem"] or "",
        }
        for r in rows
    ]
    return [
        r for r in result
        if not _is_blocked_banco(r["empresa"], r["banco"])
        and not _is_blocked_conta(r["empresa"], r["banco"], r["conta"])
    ]


def get_receitas(de: str = "2026-01-01", ate: str = "2026-06-30") -> list[dict]:
    global _REAJ_TABLE
    if _REAJ_TABLE is None:
        _REAJ_TABLE = _get_reaj_table() or ""

    valor_expr = "CASE WHEN cr.Empresa_prc = 5 THEN ISNULL(reaj.Valor_reaj, cr.Valor_Prc) ELSE cr.Valor_Prc END" if _REAJ_TABLE else "cr.Valor_Prc"
    reaj_join = f"LEFT JOIN dbo.[{_REAJ_TABLE}] reaj ON reaj.Empresa_reaj = cr.Empresa_Prc AND reaj.Obra_reaj = cr.Obra_Prc AND reaj.NumVenda_reaj = cr.NumVend_Prc AND reaj.NumParc_reaj = cr.NumParc_Prc AND reaj.NumParcGer_reaj = cr.NumParcGer_Prc AND reaj.Tipo_reaj = cr.Tipo_Prc" if _REAJ_TABLE else ""

    sql_template = """
    SELECT Empresa, Obra, Cliente, Tipo, Data, DataVenc, Valor, Status, Banco, Conta
    FROM (
        SELECT
            CASE cr.Empresa_prc
                WHEN 1 THEN 'COMBRASEN' WHEN 3 THEN 'DRESDEN'
                WHEN 4 THEN 'TRUST'     WHEN 5 THEN 'GAMA 01'
                WHEN 6 THEN 'CONSÓRCIO HMSJ'
                ELSE CAST(cr.Empresa_prc AS VARCHAR)
            END AS Empresa,
            CAST(cr.Obra_Prc AS VARCHAR) AS Obra,
            ISNULL(p.nome_pes, '') AS Cliente,
            cr.Tipo_Prc AS Tipo,
            CONVERT(VARCHAR(10), ISNULL(cr.DataPror_Prc, cr.Data_Prc), 103) AS Data,
            CONVERT(VARCHAR(10), ISNULL(cr.DataPror_Prc, cr.Data_Prc), 103) AS DataVenc,
            {valor_expr} AS Valor,
            'A Receber' AS Status,
            ISNULL(CAST(pcb.NumeroBanco_pcb AS VARCHAR), ISNULL(CAST(cr.NumeroBanco_prc AS VARCHAR), '')) AS Banco,
            ISNULL(pcb.ContaBanco_pcb, ISNULL(cr.ContaBanco_prc, '')) AS Conta
        FROM ContasReceber cr
        LEFT JOIN Pessoas p ON p.cod_pes = cr.Cliente_Prc
        LEFT JOIN ParametroCobranca pcb
            ON pcb.Empresa_pcb = cr.Empresa_Prc
           AND pcb.Num_pcb = cr.NumPcb_Prc
        {reaj_join}
        WHERE cr.Status_Prc = 0
          AND ISNULL(cr.DataPror_Prc, cr.Data_Prc) BETWEEN %s AND %s

        UNION ALL

        SELECT
            CASE v.Empresa
                WHEN 1 THEN 'COMBRASEN' WHEN 3 THEN 'DRESDEN'
                WHEN 4 THEN 'TRUST'     WHEN 5 THEN 'GAMA 01'
                WHEN 6 THEN 'CONSÓRCIO HMSJ'
                ELSE CAST(v.Empresa AS VARCHAR)
            END AS Empresa,
            CAST(v.Obra AS VARCHAR) AS Obra,
            ISNULL(v.[Nome cliente], '') AS Cliente,
            v.[Tipo parcela] AS Tipo,
            CONVERT(VARCHAR(10), v.Data, 103) AS Data,
            CONVERT(VARCHAR(10), v.Data, 103) AS DataVenc,
            v.[Valor recebido] AS Valor,
            'Recebida' AS Status,
            ISNULL(CAST(rp.BancoDep_Rpg AS VARCHAR), '') AS Banco,
            ISNULL(rp.ContaDep_Rpg, '') AS Conta
        FROM VWBI_Receitas v
        LEFT JOIN Recebidas rec
            ON  rec.Empresa_rec = v.Empresa
            AND rec.NumVend_Rec  = v.[Numero Venda]
            AND rec.Obra_Rec     = v.Obra
            AND rec.NumParc_Rec  = v.[Numero parcela]
            AND CAST(rec.Data_Rec AS DATE) = CAST(v.Data AS DATE)
            AND rec.Status_Rec   = 1
        LEFT JOIN RecebePgto rp
            ON  rp.Empresa_rpg  = rec.Empresa_rec
            AND rp.NumReceb_Rpg = rec.NumReceb_Rec
        WHERE v.StatusPL = 'REALIZADO'
          AND v.[Valor recebido] > 0
          AND v.Data BETWEEN %s AND %s

        UNION ALL

        SELECT
            CASE r.Empresa_rec
                WHEN 1 THEN 'COMBRASEN' WHEN 3 THEN 'DRESDEN'
                WHEN 4 THEN 'TRUST'     WHEN 5 THEN 'GAMA 01'
                WHEN 6 THEN 'CONSÓRCIO HMSJ'
                ELSE CAST(r.Empresa_rec AS VARCHAR)
            END AS Empresa,
            CAST(r.Obra_Rec AS VARCHAR) AS Obra,
            ISNULL(p.nome_pes, '') AS Cliente,
            r.Tipo_Rec AS Tipo,
            CONVERT(VARCHAR(10), r.Data_Rec, 103) AS Data,
            CONVERT(VARCHAR(10), r.DataVenci_Rec, 103) AS DataVenc,
            r.ValorConf_Rec AS Valor,
            'Recebida' AS Status,
            ISNULL(CAST(rp.BancoDep_Rpg AS VARCHAR), '') AS Banco,
            ISNULL(rp.ContaDep_Rpg, '') AS Conta
        FROM Recebidas r
        LEFT JOIN Pessoas p ON p.cod_pes = r.Cliente_Rec
        LEFT JOIN RecebePgto rp
            ON  rp.Empresa_rpg  = r.Empresa_rec
            AND rp.NumReceb_Rpg = r.NumReceb_Rec
        WHERE r.Status_Rec = 1
          AND r.Data_Rec BETWEEN %s AND %s
          AND r.Empresa_rec NOT IN (SELECT DISTINCT Empresa FROM VWBI_Receitas)
    ) t
    ORDER BY Data, Empresa, Obra
    """

    # Try with reajuste column; if it fails, fall back to Valor_Prc only
    try:
        sql = sql_template.format(valor_expr=valor_expr, reaj_join=reaj_join)
        with get_db() as conn:
            cur = conn.cursor(as_dict=True)
            cur.execute(sql, (de, ate, de, ate, de, ate))
            rows = cur.fetchall()
    except Exception:
        _REAJ_TABLE = ""
        sql = sql_template.format(valor_expr="cr.Valor_Prc", reaj_join="")
        with get_db() as conn:
            cur = conn.cursor(as_dict=True)
            cur.execute(sql, (de, ate, de, ate, de, ate))
            rows = cur.fetchall()
    result = [
        {
            "empresa": r["Empresa"] or "",
            "obra": r["Obra"] or "",
            "cliente": (r["Cliente"] or "").strip(),
            "tipo": r["Tipo"] or "",
            "data": r["Data"] or "",
            "data_venc": r["DataVenc"] or "",
            "valor": float(r["Valor"] or 0),
            "status": r["Status"] or "",
            "banco": str(r["Banco"] or "").strip(),
            "conta": str(r["Conta"] or "").strip(),
        }
        for r in rows
    ]
    for r in result:
        if r["empresa"] == "GAMA 01" and r["status"] == "A Receber":
            try:
                d = datetime.strptime(r["data"], "%d/%m/%Y") + timedelta(days=1)
                r["data"] = d.strftime("%d/%m/%Y")
                dv = datetime.strptime(r["data_venc"], "%d/%m/%Y") + timedelta(days=1)
                r["data_venc"] = dv.strftime("%d/%m/%Y")
            except (ValueError, TypeError):
                pass
    # Receitas com banco vazio (ex.: "A Receber" sem conta definida) passam normalmente.
    return [
        r for r in result
        if not (r["banco"] and _is_blocked_banco(r["empresa"], r["banco"]))
        and not (r["banco"] and _is_blocked_conta(r["empresa"], r["banco"], r["conta"]))
    ]


def get_transferencias(de: str = "2020-01-01", ate: str = "2030-12-31") -> list[dict]:
    """Transferências bancárias (TransfBco). Cada linha gera até 2 registros (perna débito e crédito)."""
    sql = """
    SELECT
        Empresa_tb, EmpresaCred_tb,
        CAST(BcoDeb_tb AS VARCHAR) AS BcoDeb, ContaDeb_tb,
        CAST(BcoCred_tb AS VARCHAR) AS BcoCred, ContaCred_tb,
        Valor_tb, Obs_tb,
        CONVERT(VARCHAR(10), Data_tb, 103) AS Data
    FROM TransfBco
    WHERE Data_tb BETWEEN %s AND %s
    ORDER BY Data_tb
    """
    with get_db() as conn:
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, (de, ate))
        rows = cur.fetchall()

    result: list[dict] = []
    for r in rows:
        descricao = (r["Obs_tb"] or "").strip() or "S/Descrição"
        valor = float(r["Valor_tb"] or 0)
        data = r["Data"] or ""

        emp_deb = EMPRESA_MAP.get(r["Empresa_tb"], "")
        banco_deb = str(r["BcoDeb"] or "").strip()
        conta_deb = str(r["ContaDeb_tb"] or "").strip()
        if emp_deb and not _is_blocked_banco(emp_deb, banco_deb) and not _is_blocked_conta(emp_deb, banco_deb, conta_deb):
            result.append({
                "empresa": emp_deb,
                "sentido": "saida",
                "descricao": descricao,
                "valor": valor,
                "data": data,
                "banco": banco_deb,
                "conta": conta_deb,
            })

        emp_cred = EMPRESA_MAP.get(r["EmpresaCred_tb"], "")
        banco_cred = str(r["BcoCred"] or "").strip()
        conta_cred = str(r["ContaCred_tb"] or "").strip()
        if emp_cred and not _is_blocked_banco(emp_cred, banco_cred) and not _is_blocked_conta(emp_cred, banco_cred, conta_cred):
            result.append({
                "empresa": emp_cred,
                "sentido": "entrada",
                "descricao": descricao,
                "valor": valor,
                "data": data,
                "banco": banco_cred,
                "conta": conta_cred,
            })
    return result


def get_controle_financeiro(de: str = "2020-01-01", ate: str = "2030-12-31") -> list[dict]:
    """Controle financeiro (EntSaiEmpAplic). EntSai_es: 0=Entrada, 1=Saída."""
    sql = """
    SELECT
        CASE es.Empresa_es
            WHEN 1 THEN 'COMBRASEN' WHEN 3 THEN 'DRESDEN'
            WHEN 4 THEN 'TRUST'     WHEN 5 THEN 'GAMA 01'
            WHEN 6 THEN 'CONSÓRCIO HMSJ'
        END AS Empresa,
        ISNULL(ctm.Desc_cger, 'S/Natureza') AS Natureza,
        es.EntSai_es,
        es.Valor_es,
        CONVERT(VARCHAR(10), es.Data_es, 103) AS Data,
        CAST(es.Banco_es AS VARCHAR) AS Banco,
        es.Conta_es AS Conta
    FROM EntSaiEmpAplic es
    LEFT JOIN CategoriasDeTipoDeMovimentacao ctm ON es.Natureza_es = ctm.Codigo_cger
    WHERE es.Empresa_es IN (1, 3, 4, 5, 6)
      AND es.Data_es BETWEEN %s AND %s
    ORDER BY es.Data_es
    """
    with get_db() as conn:
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, (de, ate))
        rows = cur.fetchall()

    result = [
        {
            "empresa": r["Empresa"] or "",
            "sentido": "entrada" if r["EntSai_es"] == 0 else "saida",
            "descricao": (r["Natureza"] or "S/Natureza").strip(),
            "valor": float(r["Valor_es"] or 0),
            "data": r["Data"] or "",
            "banco": str(r["Banco"] or "").strip(),
            "conta": str(r["Conta"] or "").strip(),
        }
        for r in rows
    ]
    return [
        r for r in result
        if not _is_blocked_banco(r["empresa"], r["banco"])
        and not _is_blocked_conta(r["empresa"], r["banco"], r["conta"])
    ]


def get_saldo_banco(de: str = "2020-01-01", ate: str = "2030-12-31") -> list[dict]:
    global _SALDO_CONTA_COL
    if _SALDO_CONTA_COL is None:
        _SALDO_CONTA_COL = _get_saldo_conta_col() or ""

    conta_select = f"ISNULL({_SALDO_CONTA_COL}, '')" if _SALDO_CONTA_COL else "''"
    sql = f"""
    SELECT
        CASE Empresa_sdcc
            WHEN 1 THEN 'COMBRASEN' WHEN 3 THEN 'DRESDEN'
            WHEN 4 THEN 'TRUST'     WHEN 5 THEN 'GAMA 01'
            WHEN 6 THEN 'CONSÓRCIO HMSJ'
        END AS Empresa,
        CAST(Banco_sdcc AS VARCHAR) AS Banco,
        {conta_select} AS Conta,
        CONVERT(varchar, Data_sdcc, 103) AS Data,
        Saldo_sdcc AS Saldo
    FROM SaldoConta
    WHERE Data_sdcc BETWEEN %s AND %s
      AND Empresa_sdcc IN (1, 3, 4, 5, 6)
    ORDER BY Data_sdcc, Empresa_sdcc, Banco_sdcc
    """
    with get_db() as conn:
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, (de, ate))
        rows = cur.fetchall()
    result = [
        {
            "empresa": r["Empresa"] or "",
            "banco": str(r["Banco"] or "").strip(),
            "conta": str(r["Conta"] or "").strip(),
            "data": r["Data"] or "",
            "saldo": float(r["Saldo"] or 0),
        }
        for r in rows
    ]
    return [
        r for r in result
        if not _is_blocked_banco(r["empresa"], r["banco"])
        and not _is_blocked_conta(r["empresa"], r["banco"], r["conta"])
    ]
