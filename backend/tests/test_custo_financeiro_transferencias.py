import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.fluxo_obras import _lancamentos_classificados
from app.services.queries import get_transferencias


EMPRESA = "COMBRASEN"
DATA = "14/08/2026"


def transferencia(*, lancamento_id: str, sentido: str, banco: str, conta: str, origem: dict, destino: dict):
    return {
        "id": lancamento_id,
        "tipo": "transferencia",
        "empresa": EMPRESA,
        "sentido": sentido,
        "descricao": "EMPRESTIMO BTG - BNDES CRED DIGITAL",
        "valor": 291560.31,
        "data": DATA,
        "banco": banco,
        "conta": conta,
        "origem": origem,
        "destino": destino,
    }


class CustoFinanceiroTransferenciasTests(IsolatedAsyncioTestCase):
    async def classificar(self, transferencias, regras):
        categorias = [{"id": 15, "nome": "Emprestimos bancários", "sinal": "entrada", "ordem": 12}]
        with (
            patch("app.api.fluxo_obras.get_cached", new=AsyncMock(side_effect=[transferencias, []])),
            patch("app.api.fluxo_obras.pg.get_custo_financeiro_categorias", new=AsyncMock(return_value=categorias)),
            patch("app.api.fluxo_obras.pg.get_custo_financeiro_overrides", new=AsyncMock(return_value={})),
            patch("app.api.fluxo_obras.pg.get_custo_financeiro_regras_par", new=AsyncMock(return_value=regras)),
        ):
            return await _lancamentos_classificados({EMPRESA})

    async def test_emprestimo_bancario_mesma_empresa_mantem_so_a_perna_de_caixa(self):
        origem = {"empresa": EMPRESA, "banco": "208", "conta": "448329-5E"}
        destino = {"empresa": EMPRESA, "banco": "208", "conta": "448329-5"}
        regras = [
            {
                "empresa_origem": EMPRESA, "empresa_destino": EMPRESA,
                "banco": "208", "conta": "448329-5E", "anular": False,
                "categoria_positiva_id": 15, "categoria_negativa_id": None, "rotulo": "EMPRESTIMO BANCARIO",
            },
            {
                "empresa_origem": EMPRESA, "empresa_destino": EMPRESA,
                "banco": "208", "conta": "448329-5", "anular": True,
                "categoria_positiva_id": None, "categoria_negativa_id": None, "rotulo": "Interno",
            },
        ]
        transferencias = [
            transferencia(lancamento_id="saida-especial", sentido="saida", banco="208", conta="448329-5E", origem=origem, destino=destino),
            transferencia(lancamento_id="entrada-caixa", sentido="entrada", banco="208", conta="448329-5", origem=origem, destino=destino),
        ]

        lancamentos, suprimidos, _ = await self.classificar(transferencias, regras)

        self.assertEqual([], suprimidos)
        self.assertEqual(1, len(lancamentos))
        self.assertEqual("entrada-caixa", lancamentos[0]["id"])
        self.assertEqual(15, lancamentos[0]["categoria_id"])

    async def test_conta_especial_sem_categoria_aparece_nao_classificada(self):
        origem = {"empresa": EMPRESA, "banco": "208", "conta": "448329-5E"}
        destino = {"empresa": EMPRESA, "banco": "208", "conta": "448329-5"}
        regras = [{
            "empresa_origem": EMPRESA, "empresa_destino": EMPRESA,
            "banco": "208", "conta": "448329-5E", "anular": False,
            "categoria_positiva_id": None, "categoria_negativa_id": None, "rotulo": "EMPRESTIMO BANCARIO",
        }]
        transferencias = [
            transferencia(lancamento_id="saida-especial", sentido="saida", banco="208", conta="448329-5E", origem=origem, destino=destino),
            transferencia(lancamento_id="entrada-caixa", sentido="entrada", banco="208", conta="448329-5", origem=origem, destino=destino),
        ]

        lancamentos, _, _ = await self.classificar(transferencias, regras)

        self.assertEqual(1, len(lancamentos))
        self.assertIsNone(lancamentos[0]["categoria_id"])

    async def test_transferencia_interna_sem_regra_permanece_oculta(self):
        origem = {"empresa": EMPRESA, "banco": "341", "conta": "11111-1"}
        destino = {"empresa": EMPRESA, "banco": "341", "conta": "22222-2"}
        transferencias = [
            transferencia(lancamento_id="saida-interna", sentido="saida", banco="341", conta="11111-1", origem=origem, destino=destino),
            transferencia(lancamento_id="entrada-interna", sentido="entrada", banco="341", conta="22222-2", origem=origem, destino=destino),
        ]

        lancamentos, suprimidos, _ = await self.classificar(transferencias, [])

        self.assertEqual([], lancamentos)
        self.assertEqual([], suprimidos)

    def test_extracao_preserva_duas_pernas_de_transferencia_mesma_empresa(self):
        class Cursor:
            def execute(self, *_args):
                pass

            def fetchall(self):
                return [{
                    "Empresa_tb": 1, "EmpresaCred_tb": 1,
                    "BcoDeb": "208", "ContaDeb_tb": "448329-5E",
                    "BcoCred": "208", "ContaCred_tb": "448329-5",
                    "Valor_tb": 291560.31,
                    "Obs_tb": "EMPRESTIMO BTG - BNDES CRED DIGITAL",
                    "Data": DATA,
                }]

        class Connection:
            def cursor(self, **_kwargs):
                return Cursor()

        class Database:
            def __enter__(self):
                return Connection()

            def __exit__(self, *_args):
                pass

        with patch("app.services.queries.get_db", return_value=Database()):
            lancamentos = get_transferencias("2026-08-14", "2026-08-14")

        self.assertEqual(2, len(lancamentos))
        self.assertEqual({"saida", "entrada"}, {lc["sentido"] for lc in lancamentos})
        self.assertEqual(291560.31, lancamentos[0]["valor"])
