-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalGameId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "pgn" TEXT NOT NULL,
    "whiteUsername" TEXT NOT NULL,
    "blackUsername" TEXT NOT NULL,
    "endedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Game_provider_externalGameId_key" ON "Game"("provider", "externalGameId");
