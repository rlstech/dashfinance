"""
Cria o primeiro usuário admin no PostgreSQL.

Uso:
    python scripts/create_admin.py --email admin@example.com --name "Admin" --password "SenhaForte123"

Requer variável de ambiente PG_DSN ou usa o valor padrão de config.py.
"""
import argparse
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from passlib.context import CryptContext
import asyncpg
from app.config import settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

EMPRESAS = ["COMBRASEN", "DRESDEN", "TRUST", "GAMA 01", "CONSÓRCIO HMSJ"]


async def main(email: str, name: str, password: str):
    conn = await asyncpg.connect(settings.PG_DSN)
    try:
        existing = await conn.fetchrow("SELECT id FROM users WHERE email=$1", email)
        if existing:
            print(f"Usuário {email} já existe (id={existing['id']})")
            return

        hashed = _pwd.hash(password)
        row = await conn.fetchrow(
            "INSERT INTO users (email, name, password_hash, is_admin) VALUES ($1,$2,$3,TRUE) RETURNING id",
            email, name, hashed,
        )
        user_id = row["id"]
        await conn.executemany(
            "INSERT INTO user_empresas (user_id, empresa) VALUES ($1, $2)",
            [(user_id, e) for e in EMPRESAS],
        )
        print(f"Admin criado: id={user_id}, email={email}")
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    asyncio.run(main(args.email, args.name, args.password))
