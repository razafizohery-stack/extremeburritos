-- Migration: Add category_id column to menus table
ALTER TABLE public.menus ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL;
