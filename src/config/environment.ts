export function readEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const portValue = env.PORT ?? '3000';
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const databaseUrl = env.DATABASE_URL;
  const parsedUrl = databaseUrl ? URL.parse(databaseUrl) : null;
  if (
    !databaseUrl ||
    !parsedUrl?.hostname ||
    parsedUrl.pathname.length < 2 ||
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol)
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with a host and database name');
  }

  return { port, databaseUrl };
}
