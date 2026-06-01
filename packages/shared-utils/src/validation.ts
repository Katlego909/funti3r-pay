import { z } from 'zod';

export const emailSchema = z
  .string()
  .email('Invalid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain uppercase letter')
  .regex(/[0-9]/, 'Password must contain number');

export const uuidSchema = z
  .string()
  .uuid('Invalid UUID format');

export const currencySchema = z
  .enum(['USD', 'NGN', 'KES', 'GHS', 'ZAR', 'XLM']);

export const amountSchema = z
  .number()
  .positive('Amount must be greater than 0')
  .max(999999999, 'Amount exceeds maximum');

export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1, 'First name required').optional(),
  lastName: z.string().min(1, 'Last name required').optional(),
  phoneNumber: phoneSchema.optional(),
});

export const paymentSchema = z.object({
  workerId: uuidSchema,
  amount: amountSchema,
  currency: currencySchema,
  description: z.string().optional(),
});
