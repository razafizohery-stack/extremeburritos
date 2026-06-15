-- Migration: Add contains_pork column to produits table
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS contains_pork BOOLEAN DEFAULT FALSE;

-- Migration: Add contains_pork column to menus table
ALTER TABLE public.menus ADD COLUMN IF NOT EXISTS contains_pork BOOLEAN DEFAULT FALSE;
