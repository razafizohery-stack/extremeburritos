-- Migration: Add type column to categories
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'product';
