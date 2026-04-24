import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projectFields = z.object({
  title: z.string(),
  slug: z.string(),
  category: z.enum(['fotografie', 'video', 'webdesign', 'design']),
  date: z.coerce.date().optional(),
  order: z.number().default(99),
  cover: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  gallery: z.array(z.string()).default([]),
  youtube: z.array(z.string().url()).default([]),
  videos: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
});

const projectsDe = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects/de' }),
  schema: projectFields,
});

const projectsEn = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects/en' }),
  schema: projectFields,
});

export const collections = {
  'projects-de': projectsDe,
  'projects-en': projectsEn,
};
