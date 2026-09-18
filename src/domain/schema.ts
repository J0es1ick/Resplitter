import { z } from 'zod';
import { currencies } from './currency';
import { quantityUnits } from './quantity';

const quantitySchema = z
  .number()
  .positive()
  .max(10000)
  .refine((value) => {
    try {
      quantityUnits(value);
      return true;
    } catch {
      return false;
    }
  }, 'Quantity must have at most three decimal places');
const quantitiesSchema = z
  .record(z.string().min(1).max(40), quantitySchema)
  .refine((values) => Object.keys(values).length <= 100, 'Too many quantities');

export const minorSchema = z.number().int().min(0).max(100_000_000);
export const receiptSchema = z
  .object({
    receiptNumber: z.string().max(120),
    date: z.string().max(40),
    time: z.string().max(40),
    waiter: z.string().max(120),
    currency: z.enum(currencies),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          name: z.string().trim().min(1).max(120),
          quantity: quantitySchema,
          unitPriceMinor: minorSchema,
          lineTotalMinor: minorSchema,
          confidence: z.number().min(0).max(1).optional()
        })
      )
      .max(100)
      .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'Duplicate item IDs'),
    subtotalMinor: minorSchema,
    totalMinor: minorSchema,
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string().max(500)).max(20)
  })
  .refine((r) => r.subtotalMinor === r.items.reduce((sum, i) => sum + i.lineTotalMinor, 0), 'Subtotal mismatch');

export const sessionSchema = z.object({
  id: z.string().min(1).max(40),
  ownerUserId: z.number().int().positive(),
  sourceChatId: z.number().int(),
  receipt: receiptSchema,
  version: z.number().int().positive(),
  status: z.enum(['draft', 'open', 'finalized']).default('draft'),
  splitMode: z.enum(['items', 'equal']).default('items'),
  inviteToken: z.string().max(50).optional(),
  participants: z.record(
    z.string(),
    z.object({
      userId: z.number().int().positive(),
      displayName: z.string().max(120),
      itemIds: z.array(z.string().max(40)).max(100),
      itemQuantities: quantitiesSchema.optional(),
      updatedAt: z.string().datetime()
    })
  ),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});

export const selectionSchema = z
  .object({
    version: z.number().int().positive(),
    itemIds: z.array(z.string().min(1).max(40)).max(100),
    itemQuantities: quantitiesSchema.optional()
  })
  .strict();
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
