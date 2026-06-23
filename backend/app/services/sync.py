"""
Sincronizacao periodica e manual de dados.
"""
import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.services.cache import get_cached, set_cached, invalidate_prefix
from app.services.queries import get_ap, get_receitas, get_saldo_banco, get_transferencias, get_controle_financeiro
from app.services.excel import get_excel_data

log = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def sync_all() -> dict:
    """
    Sincronizacao principal: busca dados do SQL Server + Excel,
    armazena no Redis e retorna metadados.
    """
    log.info("Iniciando sincronizacao...")
    de = settings.SYNC_DATE_FROM
    ate = settings.SYNC_DATE_TO
    errors: list[str] = []

    ap_data: list[dict] = []
    rec_data: list[dict] = []
    saldo_data: list[dict] = []
    transf_data: list[dict] = []
    controle_data: list[dict] = []

    try:
        ap_data = get_ap(de, ate)
    except Exception as e:
        errors.append(f"ap: {e}")
        log.error("Erro ao buscar AP: %s", e)

    try:
        rec_data = get_receitas(de, ate)
    except Exception as e:
        errors.append(f"receitas: {e}")
        log.error("Erro ao buscar receitas: %s", e)

    try:
        saldo_data = get_saldo_banco(de, ate)
    except Exception as e:
        errors.append(f"saldo_banco: {e}")
        log.error("Erro ao buscar saldo: %s", e)

    try:
        transf_data = get_transferencias(de, ate)
    except Exception as e:
        errors.append(f"transferencias: {e}")
        log.error("Erro ao buscar transferências: %s", e)

    try:
        controle_data = get_controle_financeiro(de, ate)
    except Exception as e:
        errors.append(f"controle_financeiro: {e}")
        log.error("Erro ao buscar controle financeiro: %s", e)

    # Merge Excel data
    try:
        ex_ap, ex_rec = get_excel_data()
        ap_data.extend(ex_ap)
        rec_data.extend(ex_rec)
    except Exception as exc:
        log.warning("Excel sync ignorado: %s", exc)

    last_sync = datetime.now().strftime("%d/%m/%Y %H:%M")

    # Invalidar caches antigos e salvar novos (TTL longo — ate proximo sync)
    ttl = settings.SYNC_INTERVAL_MINUTES * 60 + 300  # intervalo + margem

    await invalidate_prefix("ap")
    await invalidate_prefix("receitas")
    await invalidate_prefix("saldo")
    await invalidate_prefix("filters")
    await invalidate_prefix("transferencias")
    await invalidate_prefix("controle")

    await set_cached("dash:ap:all", ap_data, ttl=ttl)
    await set_cached("dash:receitas:all", rec_data, ttl=ttl)
    await set_cached("dash:saldo:all", saldo_data, ttl=ttl)
    await set_cached("dash:transferencias:all", transf_data, ttl=ttl)
    await set_cached("dash:controle:all", controle_data, ttl=ttl)
    await set_cached(
        "dash:meta",
        {"last_sync": last_sync, "de": de, "ate": ate},
        ttl=ttl,
    )

    # Pre-computar filtros
    await _precompute_filters(ap_data, rec_data, saldo_data, ttl)

    result = {
        "ok": len(errors) == 0,
        "errors": errors,
        "last_sync": last_sync,
        "count_ap": len(ap_data),
        "count_receitas": len(rec_data),
        "count_saldo": len(saldo_data),
        "count_transferencias": len(transf_data),
        "count_controle": len(controle_data),
    }
    log.info("Sincronizacao concluida: %s", result)
    return result


async def _precompute_filters(
    ap_data: list[dict],
    rec_data: list[dict],
    saldo_data: list[dict],
    ttl: int,
):
    """Pre-computa opcoes de filtros em cascata a partir dos dados sincronizados."""
    all_data = ap_data + rec_data + saldo_data

    empresas = sorted(set(r.get("empresa", "") for r in all_data if r.get("empresa")))

    obras_por_empresa: dict[str, set[str]] = {}
    bancos_por_empresa: dict[str, set[str]] = {}
    contas_por_empresa: dict[str, set[str]] = {}
    contas_por_empresa_banco: dict[str, dict[str, set[str]]] = {}

    for r in all_data:
        emp = r.get("empresa", "")
        if not emp:
            continue
        if r.get("obra"):
            obras_por_empresa.setdefault(emp, set()).add(r["obra"])
        if r.get("banco"):
            bancos_por_empresa.setdefault(emp, set()).add(r["banco"])
        if r.get("conta"):
            contas_por_empresa.setdefault(emp, set()).add(r["conta"])
        if r.get("banco") and r.get("conta"):
            contas_por_empresa_banco.setdefault(emp, {}).setdefault(r["banco"], set()).add(r["conta"])

    tree = {
        "empresas": empresas,
        "obras_por_empresa": {k: sorted(v) for k, v in obras_por_empresa.items()},
        "bancos_por_empresa": {k: sorted(v) for k, v in bancos_por_empresa.items()},
        "contas_por_empresa": {k: sorted(v) for k, v in contas_por_empresa.items()},
        "contas_por_empresa_banco": {
            emp: {b: sorted(cs) for b, cs in bdict.items()}
            for emp, bdict in contas_por_empresa_banco.items()
        },
    }
    await set_cached("dash:filters:tree", tree, ttl=ttl)


def start_scheduler():
    if settings.SYNC_INTERVAL_MINUTES > 0:
        scheduler.add_job(
            sync_all,
            "interval",
            minutes=settings.SYNC_INTERVAL_MINUTES,
            id="sync_all",
            replace_existing=True,
        )
        scheduler.start()
        log.info("Scheduler iniciado: sync a cada %d min", settings.SYNC_INTERVAL_MINUTES)
