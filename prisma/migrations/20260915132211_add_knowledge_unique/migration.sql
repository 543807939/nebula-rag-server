/*
  Warnings:

  - A unique constraint covering the columns `[userId,title]` on the table `KnowledgeBase` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBase_userId_title_key" ON "KnowledgeBase"("userId", "title");
