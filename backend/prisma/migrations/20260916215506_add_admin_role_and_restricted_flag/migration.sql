-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "BoardMember" ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false;
