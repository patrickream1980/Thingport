-- CreateTable
CREATE TABLE "DescriptionImage" (
    "id" TEXT NOT NULL,
    "printId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DescriptionImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DescriptionImage_printId_idx" ON "DescriptionImage"("printId");

-- AddForeignKey
ALTER TABLE "DescriptionImage" ADD CONSTRAINT "DescriptionImage_printId_fkey" FOREIGN KEY ("printId") REFERENCES "Print"("id") ON DELETE CASCADE ON UPDATE CASCADE;
