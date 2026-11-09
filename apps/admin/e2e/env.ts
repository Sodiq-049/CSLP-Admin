export const SUPER_ADMIN = { email: 'e2e-super@example.com', password: 'E2e-Super-Admin-Pass-1' };
export const mongoUri = () =>
  `${process.env.E2E_MONGO_URL ?? 'mongodb://localhost:27018'}/${process.env.E2E_DB}?directConnection=true`;
