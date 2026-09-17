-- CreateTable
CREATE TABLE "CardAssignee" (
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CardAssignee_pkey" PRIMARY KEY ("cardId","userId")
);

-- AddForeignKey
ALTER TABLE "CardAssignee" ADD CONSTRAINT "CardAssignee_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAssignee" ADD CONSTRAINT "CardAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migra os dados existentes: cada card com assigneeId vira uma linha em
-- CardAssignee, antes da coluna antiga ser removida. Sem isso, quem já
-- tinha um responsável atribuído perderia essa informação na migração.
INSERT INTO "CardAssignee" ("cardId", "userId")
SELECT "id", "assigneeId" FROM "Card" WHERE "assigneeId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Card" DROP CONSTRAINT "Card_assigneeId_fkey";

-- AlterTable
ALTER TABLE "Card" DROP COLUMN "assigneeId";
