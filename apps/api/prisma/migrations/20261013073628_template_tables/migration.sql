-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "kind" "template_kind" NOT NULL DEFAULT 'signature',
    "file_key" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parent_template_id" UUID,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_departments" (
    "template_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_departments_pkey" PRIMARY KEY ("template_id","department_id")
);

-- CreateTable
CREATE TABLE "template_fields" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "field_type" "template_field_type" NOT NULL,
    "page" INTEGER NOT NULL,
    "x" DECIMAL(7,2) NOT NULL,
    "y" DECIMAL(7,2) NOT NULL,
    "width" DECIMAL(7,2) NOT NULL,
    "height" DECIMAL(7,2) NOT NULL,
    "font_size" INTEGER,
    "label" VARCHAR(255),
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "templates_parent_template_id_key" ON "templates"("parent_template_id");

-- CreateIndex
CREATE INDEX "template_departments_department_id_idx" ON "template_departments"("department_id");

-- CreateIndex
CREATE INDEX "template_fields_template_id_idx" ON "template_fields"("template_id");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_parent_template_id_fkey" FOREIGN KEY ("parent_template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_departments" ADD CONSTRAINT "template_departments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_departments" ADD CONSTRAINT "template_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (PRD section 12). Not expressible in schema.prisma, so they live only here.
-- font_size may be NULL: a CHECK only fails when it evaluates to FALSE.
ALTER TABLE "templates"
  ADD CONSTRAINT "templates_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "templates_page_count_check" CHECK ("page_count" >= 1);

ALTER TABLE "template_fields"
  ADD CONSTRAINT "template_fields_page_check" CHECK ("page" >= 1),
  ADD CONSTRAINT "template_fields_x_check" CHECK ("x" >= 0),
  ADD CONSTRAINT "template_fields_y_check" CHECK ("y" >= 0),
  ADD CONSTRAINT "template_fields_width_check" CHECK ("width" > 0),
  ADD CONSTRAINT "template_fields_height_check" CHECK ("height" > 0),
  ADD CONSTRAINT "template_fields_font_size_check" CHECK ("font_size" > 0);
