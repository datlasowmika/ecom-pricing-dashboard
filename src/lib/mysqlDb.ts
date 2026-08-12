export type DbCreds = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export async function loadDbCreds(): Promise<DbCreds> {
  const envHost = process.env.NBS_DB_HOST ?? process.env.DB_HOST;
  if (envHost) {
    return {
      host: envHost,
      port: Number(process.env.NBS_DB_PORT ?? process.env.DB_PORT ?? 6033),
      user: process.env.NBS_DB_USER ?? process.env.DB_USER ?? "",
      password: process.env.NBS_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "",
      database: process.env.NBS_DB_DATABASE ?? process.env.DB_DATABASE ?? "cyclops",
    };
  }

  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const raw = await readFile(join(process.cwd(), "dbcredentials"), "utf8");
  const parsed = JSON.parse(raw) as {
    host: string;
    port: number | string;
    user: string;
    password: string;
    database: string;
  };
  return {
    host: parsed.host,
    port: Number(parsed.port),
    user: parsed.user,
    password: parsed.password,
    database: parsed.database,
  };
}

export async function withMysqlConnection<T>(
  fn: (conn: import("mysql2/promise").Connection) => Promise<T>,
  opts?: { database?: string },
): Promise<T> {
  const mysql = await import("mysql2/promise");
  const creds = await loadDbCreds();
  const conn = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    database: opts?.database ?? creds.database,
    connectTimeout: 30_000,
    dateStrings: true,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}
