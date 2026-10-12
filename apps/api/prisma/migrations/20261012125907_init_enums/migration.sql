-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('manager', 'officer');

-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('valid', 'missing', 'invalid', 'bounced');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('preview', 'committed', 'failed');

-- CreateEnum
CREATE TYPE "template_kind" AS ENUM ('signature', 'acknowledgment', 'external_report');

-- CreateEnum
CREATE TYPE "template_field_type" AS ENUM ('full_name', 'id_number', 'date', 'signature', 'checkbox', 'text');

-- CreateEnum
CREATE TYPE "round_mode" AS ENUM ('single_template', 'by_department');

-- CreateEnum
CREATE TYPE "round_status" AS ENUM ('draft', 'sending', 'active', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('pending', 'sent', 'opened', 'signed', 'signed_manual', 'delivered', 'no_email', 'invalid_email', 'cancelled');

-- CreateEnum
CREATE TYPE "sign_method" AS ENUM ('digital', 'manual', 'kiosk');

-- CreateEnum
CREATE TYPE "email_message_type" AS ENUM ('invite', 'reminder', 'signed_copy');

-- CreateEnum
CREATE TYPE "email_message_status" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'failed');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('user', 'employee', 'system');
