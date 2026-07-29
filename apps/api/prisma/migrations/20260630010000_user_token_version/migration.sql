-- Revocación de JWT (MO-08, auditoría de seguridad): versión de token por
-- usuario. El JWT lleva `tv`; al hacer logout / resetear contraseña / cambiar
-- rol se incrementa, invalidando los tokens emitidos antes (≤12 h) sin esperar
-- a su expiración. Aditiva (columna NOT NULL con DEFAULT); segura para deploy.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
