import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.pg import reorder_custo_financeiro_categorias


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


class _Connection:
    def __init__(self, ids):
        self.ids = ids
        self.updates = []

    def transaction(self):
        return _Transaction()

    async def fetch(self, _query):
        return [{"id": categoria_id} for categoria_id in self.ids]

    async def executemany(self, _query, values):
        self.updates = values


class _Acquire:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return _Acquire(self.connection)


class ReordenarCategoriasTests(IsolatedAsyncioTestCase):
    async def test_atualiza_todas_as_categorias_na_ordem_recebida(self):
        connection = _Connection([10, 20, 30])
        with patch("app.services.pg._pool", _Pool(connection)):
            await reorder_custo_financeiro_categorias([30, 10, 20], user_id=7)

        self.assertEqual([(30, 1, 7), (10, 2, 7), (20, 3, 7)], connection.updates)

    async def test_rejeita_lista_incompleta_ou_duplicada(self):
        connection = _Connection([10, 20, 30])
        with patch("app.services.pg._pool", _Pool(connection)):
            with self.assertRaises(ValueError):
                await reorder_custo_financeiro_categorias([10, 10, 20], user_id=7)

        self.assertEqual([], connection.updates)
