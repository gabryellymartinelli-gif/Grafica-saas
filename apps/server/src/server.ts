import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  PrismaClient,
  UserRole,
  QuoteStatus,
  OrderStatus,
  ProductionStatus,
  AccountStatus,
  StockMovementType,
  PurchaseStatus,
  ArtworkStatus,
} from "@prisma/client";
import { z } from "zod";
import path from "path";
import fs from "fs";
import os from "os";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 3333);
const SECRET = process.env.JWT_SECRET;
const WEB_URL = process.env.WEB_URL || "http://localhost:5173";

if (!SECRET || SECRET.length < 32 || SECRET === "dev-secret-change-me") {
  throw new Error("JWT_SECRET deve existir e ter pelo menos 32 caracteres.");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: WEB_URL, credentials: false }));
app.use(express.json({ limit: "15mb" }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const portalLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const configuredUploadDir = process.env.UPLOAD_DIR?.trim();
const uploads = configuredUploadDir && path.isAbsolute(configuredUploadDir)
  ? configuredUploadDir
  : path.join(os.homedir(), ".grafica-saas", "uploads");
fs.mkdirSync(uploads, { recursive: true });
// Uploads are served only through authenticated artwork routes.

type AR = Request & { user?: { id: string; tenantId: string; role: UserRole } };
type PortalRequest = Request & { portal?: { customerId: string; tenantId: string; type: "customer" } };

const auth = (req: AR, res: Response, next: NextFunction) => {
  const raw = req.headers.authorization;
  const token = raw?.startsWith("Bearer ") ? raw.slice(7) : undefined;
  if (!token) return res.status(401).json({ message: "Não autenticado" });
  try {
    const payload = jwt.verify(token, SECRET) as AR["user"];
    if (!payload?.id || !payload.tenantId || !payload.role) throw new Error("invalid token");
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Sessão inválida" });
  }
};

const allow = (...roles: UserRole[]) => (req: AR, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: "Sem permissão" });
  next();
};

const asyncH = (f: any) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(f(req, res, next)).catch(next);
const tenant = (req: AR) => req.user!.tenantId;
const optionalText = z.string().trim().optional();

const getCustomer = async (tenantId: string, id: string) => prisma.customer.findFirst({ where: { id, tenantId, active: true } });
const getProduct = async (tenantId: string, id: string) => prisma.product.findFirst({ where: { id, tenantId, active: true } });
const getSupplier = async (tenantId: string, id: string) => prisma.supplier.findFirst({ where: { id, tenantId, active: true } });

app.get("/api/health", asyncH(async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, database: true });
}));

app.post("/api/auth/login", loginLimiter, asyncH(async (req, res) => {
  const x = z.object({ email: z.string().email().transform(v => v.toLowerCase().trim()), password: z.string().min(1).max(200) }).parse(req.body);
  const u = await prisma.user.findFirst({ where: { email: x.email, active: true } });
  if (!u || !(await bcrypt.compare(x.password, u.passwordHash))) return res.status(401).json({ message: "E-mail ou senha inválidos" });
  const token = jwt.sign({ id: u.id, tenantId: u.tenantId, role: u.role }, SECRET, { expiresIn: "8h" });
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

app.get("/api/me", auth, asyncH(async (req: AR, res) => {
  const u = await prisma.user.findFirst({ where: { id: req.user!.id, tenantId: tenant(req), active: true }, select: { id: true, name: true, email: true, role: true } });
  if (!u) return res.status(401).json({ message: "Usuário inválido" });
  res.json(u);
}));

app.get("/api/dashboard", auth, asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const [customers, products, quotes, orders, production, receivable, payable] = await Promise.all([
    prisma.customer.count({ where: { tenantId: t, active: true } }),
    prisma.product.count({ where: { tenantId: t, active: true } }),
    prisma.quote.count({ where: { tenantId: t } }),
    prisma.order.count({ where: { tenantId: t } }),
    prisma.productionOrder.count({ where: { tenantId: t, status: { in: [ProductionStatus.PENDING, ProductionStatus.IN_PROGRESS, ProductionStatus.PAUSED, ProductionStatus.REWORK] } } }),
    prisma.accountReceivable.aggregate({ where: { tenantId: t, status: { in: [AccountStatus.OPEN, AccountStatus.OVERDUE, AccountStatus.PARTIAL] } }, _sum: { amount: true } }),
    prisma.accountPayable.aggregate({ where: { tenantId: t, status: { in: [AccountStatus.OPEN, AccountStatus.OVERDUE, AccountStatus.PARTIAL] } }, _sum: { amount: true } }),
  ]);
  res.json({ customers, products, quotes, orders, inProduction: production, revenue: Number(receivable._sum.amount || 0), receivable: Number(receivable._sum.amount || 0), payable: Number(payable._sum.amount || 0) });
}));

app.get("/api/customers", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  res.json(await prisma.customer.findMany({ where: { tenantId: tenant(req), active: true }, orderBy: { name: "asc" } }));
}));
app.post("/api/customers", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL), asyncH(async (req: AR, res) => {
  const x = z.object({ name: z.string().trim().min(2).max(150), document: optionalText, email: z.string().email().optional().or(z.literal("")), phone: optionalText, address: optionalText, city: optionalText, state: z.string().trim().max(2).optional() }).parse(req.body);
  const customer = await prisma.customer.create({ data: { ...x, tenantId: tenant(req), email: x.email || null } });
  res.status(201).json(customer);
}));

app.get("/api/products", auth, asyncH(async (req: AR, res) => {
  const rows = await prisma.product.findMany({ where: { tenantId: tenant(req), active: true }, include: { stockItem: true }, orderBy: { name: "asc" } });
  res.json(rows.map(p => ({ ...p, cost: Number(p.cost), price: Number(p.price), stock: Number(p.stockItem?.quantity || 0), minimum: Number(p.stockItem?.minimum || 0) })));
}));
app.post("/api/products", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.STOCK), asyncH(async (req: AR, res) => {
  const x = z.object({ code: z.string().trim().min(1).max(50), name: z.string().trim().min(2).max(150), description: optionalText, unit: z.string().trim().min(1).max(10).default("UN"), cost: z.number().finite().nonnegative(), price: z.number().finite().nonnegative(), minimum: z.number().finite().nonnegative().default(0) }).parse(req.body);
  const p = await prisma.product.create({ data: { code: x.code, name: x.name, description: x.description, unit: x.unit, cost: x.cost, price: x.price, tenantId: tenant(req), stockItem: { create: { quantity: 0, minimum: x.minimum, tenantId: tenant(req) } } } });
  res.status(201).json(p);
}));

app.get("/api/quotes", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  res.json(await prisma.quote.findMany({ where: { tenantId: tenant(req) }, include: { customer: true, items: { include: { product: true } } }, orderBy: { createdAt: "desc" }, take: 100 }));
}));
app.post("/api/quotes", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({ customerId: z.string(), discount: z.number().finite().nonnegative().default(0), notes: optionalText, items: z.array(z.object({ productId: z.string(), quantity: z.number().finite().positive(), unitPrice: z.number().finite().nonnegative().optional() })).min(1) }).parse(req.body);
  if (!(await getCustomer(t, x.customerId))) return res.status(400).json({ message: "Cliente inválido" });
  const ids = [...new Set(x.items.map(i => i.productId))];
  const ps = await prisma.product.findMany({ where: { tenantId: t, id: { in: ids }, active: true } });
  if (ps.length !== ids.length) return res.status(400).json({ message: "Produto inválido" });
  const last = await prisma.quote.findFirst({ where: { tenantId: t }, orderBy: { number: "desc" } });
  const number = (last?.number || 0) + 1;
  const subtotal = x.items.reduce((sum, i) => sum + i.quantity * (i.unitPrice ?? Number(ps.find(p => p.id === i.productId)!.price)), 0);
  const total = Math.max(0, subtotal - x.discount);
  const quote = await prisma.quote.create({ data: { tenantId: t, customerId: x.customerId, number, total, discount: x.discount, notes: x.notes, items: { create: x.items.map(i => { const p = ps.find(p => p.id === i.productId)!; const unitPrice = i.unitPrice ?? Number(p.price); return { productId: i.productId, quantity: i.quantity, unitPrice, subtotal: i.quantity * unitPrice }; }) } } });
  res.status(201).json(quote);
}));
app.post("/api/quotes/:id/status", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL), asyncH(async (req: AR, res) => {
  const x = z.object({ status: z.nativeEnum(QuoteStatus) }).parse(req.body);
  const q = await prisma.quote.updateMany({ where: { id: req.params.id, tenantId: tenant(req) }, data: { status: x.status } });
  if (!q.count) return res.status(404).json({ message: "Orçamento não encontrado" });
  res.json({ ok: true });
}));
app.post("/api/quotes/:id/convert", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const q = await prisma.quote.findFirst({ where: { id: req.params.id, tenantId: t, status: QuoteStatus.APPROVED }, include: { items: true } });
  if (!q) return res.status(400).json({ message: "Orçamento não encontrado ou não aprovado" });
  const old = await prisma.order.findUnique({ where: { quoteId: q.id } });
  if (old) return res.json(old);
  const created = await prisma.$transaction(async tx => {
    const last = await tx.order.findFirst({ where: { tenantId: t }, orderBy: { number: "desc" } });
    const o = await tx.order.create({ data: { tenantId: t, customerId: q.customerId, quoteId: q.id, number: (last?.number || 0) + 1, total: q.total, status: OrderStatus.READY_PRODUCTION, items: { create: q.items.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, subtotal: i.subtotal })) } } });
    let lastProduction = await tx.productionOrder.findFirst({ where: { tenantId: t }, orderBy: { number: "desc" } });
    for (const i of q.items) {
      const number = (lastProduction?.number || 0) + 1;
      lastProduction = await tx.productionOrder.create({ data: { tenantId: t, orderId: o.id, productId: i.productId, number, quantity: i.quantity } });
    }
    await tx.accountReceivable.create({ data: { tenantId: t, customerId: q.customerId, orderId: o.id, description: `Pedido #${o.number}`, amount: q.total, dueDate: new Date(Date.now() + 30 * 86400000) } });
    return o;
  });
  res.status(201).json(created);
}));

app.get("/api/orders", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  res.json(await prisma.order.findMany({ where: { tenantId: tenant(req) }, include: { customer: true, items: { include: { product: true } }, productionOrders: true }, orderBy: { createdAt: "desc" } }));
}));
app.post("/api/orders", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({
    customerId: z.string(),
    dueDate: z.string().datetime().optional(),
    notes: optionalText,
    items: z.array(z.object({ productId: z.string(), quantity: z.number().finite().positive(), unitPrice: z.number().finite().nonnegative().optional() })).min(1)
  }).parse(req.body);
  if (!(await getCustomer(t, x.customerId))) return res.status(400).json({ message: "Cliente inválido" });
  const ids = [...new Set(x.items.map(i => i.productId))];
  const ps = await prisma.product.findMany({ where: { tenantId: t, id: { in: ids }, active: true } });
  if (ps.length !== ids.length) return res.status(400).json({ message: "Produto inválido" });
  const last = await prisma.order.findFirst({ where: { tenantId: t }, orderBy: { number: "desc" } });
  const number = (last?.number || 0) + 1;
  const total = x.items.reduce((sum, i) => sum + i.quantity * (i.unitPrice ?? Number(ps.find(p => p.id === i.productId)!.price)), 0);
  const created = await prisma.$transaction(async tx => {
    const order = await tx.order.create({ data: {
      tenantId: t, customerId: x.customerId, number, total,
      dueDate: x.dueDate ? new Date(x.dueDate) : null, notes: x.notes,
      status: OrderStatus.READY_PRODUCTION,
      items: { create: x.items.map(i => { const p = ps.find(p => p.id === i.productId)!; const unitPrice = i.unitPrice ?? Number(p.price); return { productId: i.productId, quantity: i.quantity, unitPrice, subtotal: i.quantity * unitPrice }; }) }
    }, include: { customer: true, items: { include: { product: true } } } });
    let lastOp = await tx.productionOrder.findFirst({ where: { tenantId: t }, orderBy: { number: "desc" } });
    for (const i of x.items) {
      const numberOp = (lastOp?.number || 0) + 1;
      lastOp = await tx.productionOrder.create({ data: { tenantId: t, orderId: order.id, productId: i.productId, number: numberOp, quantity: i.quantity } });
    }
    await tx.accountReceivable.create({ data: { tenantId: t, customerId: x.customerId, orderId: order.id, description: `Pedido #${number}`, amount: total, dueDate: x.dueDate ? new Date(x.dueDate) : new Date(Date.now() + 30 * 86400000) } });
    return order;
  });
  res.status(201).json(created);
}));

app.post("/api/orders/:id/status", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  const x = z.object({ status: z.nativeEnum(OrderStatus) }).parse(req.body);
  const result = await prisma.order.updateMany({ where: { id: req.params.id, tenantId: tenant(req) }, data: { status: x.status } });
  if (!result.count) return res.status(404).json({ message: "Pedido não encontrado" });
  res.json({ ok: true });
}));

app.get("/api/production", auth, allow(UserRole.ADMIN, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  res.json(await prisma.productionOrder.findMany({ where: { tenantId: tenant(req) }, include: { order: { include: { customer: true } }, product: true }, orderBy: { createdAt: "desc" } }));
}));
app.post("/api/production", auth, allow(UserRole.ADMIN, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({ orderId: z.string(), productId: z.string(), quantity: z.number().finite().positive(), notes: optionalText }).parse(req.body);
  const order = await prisma.order.findFirst({ where: { id: x.orderId, tenantId: t }, include: { items: true } });
  if (!order) return res.status(400).json({ message: "Pedido inválido" });
  if (!(await getProduct(t, x.productId))) return res.status(400).json({ message: "Produto inválido" });
  const item = order.items.find(i => i.productId === x.productId);
  if (!item) return res.status(400).json({ message: "O produto não pertence ao pedido" });
  const last = await prisma.productionOrder.findFirst({ where: { tenantId: t }, orderBy: { number: "desc" } });
  const op = await prisma.productionOrder.create({ data: { tenantId: t, orderId: order.id, productId: x.productId, number: (last?.number || 0) + 1, quantity: x.quantity, notes: x.notes } });
  res.status(201).json(op);
}));

app.post("/api/production/:id/status", auth, allow(UserRole.ADMIN, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  const x = z.object({ status: z.nativeEnum(ProductionStatus), produced: z.number().finite().nonnegative().optional(), waste: z.number().finite().nonnegative().optional(), notes: optionalText }).parse(req.body);
  const data: any = { status: x.status, ...(x.produced !== undefined ? { produced: x.produced } : {}), ...(x.waste !== undefined ? { waste: x.waste } : {}), ...(x.notes !== undefined ? { notes: x.notes } : {}), ...(x.status === ProductionStatus.IN_PROGRESS ? { startedAt: new Date() } : {}), ...(x.status === ProductionStatus.DONE ? { finishedAt: new Date() } : {}) };
  const p = await prisma.productionOrder.updateMany({ where: { id: req.params.id, tenantId: tenant(req) }, data });
  if (!p.count) return res.status(404).json({ message: "OP não encontrada" });
  res.json({ ok: true });
}));

app.get("/api/stock", auth, allow(UserRole.ADMIN, UserRole.STOCK, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  const rows = await prisma.stockItem.findMany({ where: { tenantId: tenant(req) }, include: { product: true } });
  res.json(rows.map(s => ({ ...s, quantity: Number(s.quantity), minimum: Number(s.minimum), product: { ...s.product, cost: Number(s.product.cost), price: Number(s.product.price) } })));
}));
app.post("/api/stock/movement", auth, allow(UserRole.ADMIN, UserRole.STOCK), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({ productId: z.string(), type: z.nativeEnum(StockMovementType), quantity: z.number().finite().positive(), reason: optionalText }).parse(req.body);
  if (!(await getProduct(t, x.productId))) return res.status(400).json({ message: "Produto inválido" });
  const delta = [StockMovementType.PURCHASE_IN, StockMovementType.ADJUSTMENT_IN, StockMovementType.TRANSFER_IN].includes(x.type) ? x.quantity : -x.quantity;
  const current = await prisma.stockItem.findFirst({ where: { productId: x.productId, tenantId: t } });
  const next = Number(current?.quantity || 0) + delta;
  if (next < 0) return res.status(400).json({ message: "Estoque insuficiente" });
  const s = await prisma.stockItem.upsert({ where: { productId: x.productId }, update: { quantity: next }, create: { tenantId: t, productId: x.productId, quantity: next } });
  await prisma.stockMovement.create({ data: { tenantId: t, productId: x.productId, type: x.type, quantity: x.quantity, reason: x.reason } });
  res.json(s);
}));

app.get("/api/suppliers", auth, allow(UserRole.ADMIN, UserRole.STOCK, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  res.json(await prisma.supplier.findMany({ where: { tenantId: tenant(req), active: true }, orderBy: { name: "asc" } }));
}));
app.post("/api/suppliers", auth, allow(UserRole.ADMIN, UserRole.STOCK), asyncH(async (req: AR, res) => {
  const x = z.object({ name: z.string().trim().min(2).max(150), document: optionalText, email: z.string().email().optional().or(z.literal("")), phone: optionalText, address: optionalText }).parse(req.body);
  res.status(201).json(await prisma.supplier.create({ data: { ...x, email: x.email || null, tenantId: tenant(req) } }));
}));
app.get("/api/purchases", auth, allow(UserRole.ADMIN, UserRole.STOCK, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  res.json(await prisma.purchase.findMany({ where: { tenantId: tenant(req) }, include: { supplier: true, items: { include: { product: true } }, accountsPayable: true }, orderBy: { createdAt: "desc" } }));
}));
app.post("/api/purchases", auth, allow(UserRole.ADMIN, UserRole.STOCK), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({ supplierId: z.string(), dueDate: z.string().datetime(), items: z.array(z.object({ productId: z.string(), quantity: z.number().finite().positive(), unitCost: z.number().finite().nonnegative() })).min(1) }).parse(req.body);
  if (!(await getSupplier(t, x.supplierId))) return res.status(400).json({ message: "Fornecedor inválido" });
  const ids = [...new Set(x.items.map(i => i.productId))];
  const products = await prisma.product.findMany({ where: { tenantId: t, id: { in: ids }, active: true } });
  if (products.length !== ids.length) return res.status(400).json({ message: "Produto inválido" });
  const last = await prisma.purchase.findFirst({ where: { tenantId: t }, orderBy: { number: "desc" } });
  const number = (last?.number || 0) + 1;
  const total = x.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
  const p = await prisma.purchase.create({ data: { tenantId: t, supplierId: x.supplierId, number, status: PurchaseStatus.ORDERED, total, dueDate: new Date(x.dueDate), items: { create: x.items.map(i => ({ ...i, subtotal: i.quantity * i.unitCost })) }, accountsPayable: { create: { tenantId: t, supplierId: x.supplierId, description: `Compra #${number}`, amount: total, dueDate: new Date(x.dueDate) } } }, include: { supplier: true } });
  res.status(201).json(p);
}));

app.get("/api/finance/receivable", auth, allow(UserRole.ADMIN, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  res.json(await prisma.accountReceivable.findMany({ where: { tenantId: tenant(req) }, include: { customer: true, order: true }, orderBy: { dueDate: "asc" } }));
}));
app.post("/api/finance/receivable", auth, allow(UserRole.ADMIN, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({ customerId: z.string(), orderId: z.string().optional(), description: z.string().trim().min(2).max(180), amount: z.number().finite().positive(), dueDate: z.string().datetime() }).parse(req.body);
  if (!(await getCustomer(t, x.customerId))) return res.status(400).json({ message: "Cliente inválido" });
  if (x.orderId) {
    const order = await prisma.order.findFirst({ where: { id: x.orderId, tenantId: t, customerId: x.customerId } });
    if (!order) return res.status(400).json({ message: "Pedido inválido" });
  }
  res.status(201).json(await prisma.accountReceivable.create({ data: { tenantId: t, customerId: x.customerId, orderId: x.orderId || null, description: x.description, amount: x.amount, dueDate: new Date(x.dueDate) } }));
}));
app.post("/api/finance/receivable/:id/pay", auth, allow(UserRole.ADMIN, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  const x = z.object({ amount: z.number().finite().positive() }).parse(req.body);
  const a = await prisma.accountReceivable.findFirst({ where: { id: req.params.id, tenantId: tenant(req) } });
  if (!a) return res.status(404).json({ message: "Conta não encontrada" });
  const remaining = Math.max(0, Number(a.amount) - Number(a.paidAmount));
  if (x.amount > remaining) return res.status(400).json({ message: "Valor recebido maior que o saldo da conta" });
  const paid = Number(a.paidAmount) + x.amount;
  const status = paid >= Number(a.amount) ? AccountStatus.PAID : AccountStatus.PARTIAL;
  res.json(await prisma.accountReceivable.update({ where: { id: a.id }, data: { paidAmount: paid, status, paidAt: status === AccountStatus.PAID ? new Date() : null } }));
}));
app.get("/api/finance/payable", auth, allow(UserRole.ADMIN, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  res.json(await prisma.accountPayable.findMany({ where: { tenantId: tenant(req) }, include: { supplier: true, purchase: true }, orderBy: { dueDate: "asc" } }));
}));
app.post("/api/finance/payable", auth, allow(UserRole.ADMIN, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({ supplierId: z.string(), description: z.string().trim().min(2).max(180), amount: z.number().finite().positive(), dueDate: z.string().datetime() }).parse(req.body);
  if (!(await getSupplier(t, x.supplierId))) return res.status(400).json({ message: "Fornecedor inválido" });
  res.status(201).json(await prisma.accountPayable.create({ data: { tenantId: t, supplierId: x.supplierId, description: x.description, amount: x.amount, dueDate: new Date(x.dueDate) } }));
}));
app.post("/api/finance/payable/:id/pay", auth, allow(UserRole.ADMIN, UserRole.FINANCE), asyncH(async (req: AR, res) => {
  const x = z.object({ amount: z.number().finite().positive() }).parse(req.body);
  const a = await prisma.accountPayable.findFirst({ where: { id: req.params.id, tenantId: tenant(req) } });
  if (!a) return res.status(404).json({ message: "Conta a pagar não encontrada" });
  const remaining = Math.max(0, Number(a.amount) - Number(a.paidAmount));
  if (x.amount > remaining) return res.status(400).json({ message: "Valor pago maior que o saldo da conta" });
  const paid = Number(a.paidAmount) + x.amount;
  const status = paid >= Number(a.amount) ? AccountStatus.PAID : AccountStatus.PARTIAL;
  res.json(await prisma.accountPayable.update({ where: { id: a.id }, data: { paidAmount: paid, status, paidAt: status === AccountStatus.PAID ? new Date() : null } }));
}));

app.get("/api/artworks", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  res.json(await prisma.artwork.findMany({ where: { tenantId: tenant(req) }, include: { customer: true, order: true }, orderBy: { createdAt: "desc" } }));
}));
app.post("/api/artworks", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL), asyncH(async (req: AR, res) => {
  const t = tenant(req);
  const x = z.object({ customerId: z.string(), orderId: z.string().optional(), fileName: z.string().trim().min(1).max(180), fileData: z.string().min(1), comment: optionalText }).parse(req.body);
  if (!(await getCustomer(t, x.customerId))) return res.status(400).json({ message: "Cliente inválido" });
  if (x.orderId) {
    const order = await prisma.order.findFirst({ where: { id: x.orderId, tenantId: t, customerId: x.customerId } });
    if (!order) return res.status(400).json({ message: "Pedido inválido" });
  }
  const match = x.fileData.match(/^data:(application\/pdf|image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ message: "Arquivo inválido. Use PDF, PNG, JPG, WEBP ou SVG." });
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 10 * 1024 * 1024) return res.status(413).json({ message: "Arquivo maior que 10 MB" });
  const safe = x.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safe}`;
  fs.writeFileSync(path.join(uploads, name), buffer, { flag: "wx" });
  try {
    const a = await prisma.artwork.create({ data: { tenantId: t, customerId: x.customerId, orderId: x.orderId, fileName: x.fileName, fileUrl: `/uploads/${name}`, comment: x.comment } });
    res.status(201).json(a);
  } catch (error) {
    fs.rmSync(path.join(uploads, name), { force: true });
    throw error;
  }
}));
app.get("/api/artworks/:id/file", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  const a = await prisma.artwork.findFirst({ where: { id: req.params.id, tenantId: tenant(req) } });
  if (!a) return res.status(404).json({ message: "Arte não encontrada" });
  const file = path.basename(a.fileUrl);
  const full = path.join(uploads, file);
  if (!fs.existsSync(full)) return res.status(404).json({ message: "Arquivo não encontrado no servidor" });
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
  res.sendFile(full);
}));

app.post("/api/artworks/:id/status", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL, UserRole.PRODUCTION), asyncH(async (req: AR, res) => {
  const x = z.object({ status: z.nativeEnum(ArtworkStatus), comment: optionalText }).parse(req.body);
  const result = await prisma.artwork.updateMany({ where: { id: req.params.id, tenantId: tenant(req) }, data: { status: x.status, ...(x.comment !== undefined ? { comment: x.comment } : {}) } });
  if (!result.count) return res.status(404).json({ message: "Arte não encontrada" });
  res.json({ ok: true });
}));

app.post("/api/portal/login", portalLoginLimiter, asyncH(async (req, res) => {
  const x = z.object({ email: z.string().email().transform(v => v.toLowerCase().trim()), password: z.string().min(1).max(200) }).parse(req.body);
  const candidates = await prisma.customer.findMany({ where: { email: x.email, portalEnabled: true, portalPasswordHash: { not: null } }, take: 2 });
  if (candidates.length !== 1) return res.status(401).json({ message: "Acesso inválido" });
  const c = candidates[0];
  if (!c.portalPasswordHash || !(await bcrypt.compare(x.password, c.portalPasswordHash))) return res.status(401).json({ message: "Acesso inválido" });
  res.json({ token: jwt.sign({ customerId: c.id, tenantId: c.tenantId, type: "customer" }, SECRET, { expiresIn: "8h" }), customer: { id: c.id, name: c.name, email: c.email } });
}));
app.post("/api/portal/enable", auth, allow(UserRole.ADMIN, UserRole.COMMERCIAL), asyncH(async (req: AR, res) => {
  const x = z.object({ customerId: z.string(), password: z.string().min(6).max(200) }).parse(req.body);
  const hash = await bcrypt.hash(x.password, 12);
  const c = await prisma.customer.updateMany({ where: { id: x.customerId, tenantId: tenant(req) }, data: { portalEnabled: true, portalPasswordHash: hash } });
  if (!c.count) return res.status(404).json({ message: "Cliente não encontrado" });
  res.json({ ok: true });
}));

const portalAuth = (req: PortalRequest, res: Response, next: NextFunction) => {
  const raw = req.headers.authorization;
  const token = raw?.startsWith("Bearer ") ? raw.slice(7) : undefined;
  if (!token) return res.status(401).json({ message: "Não autenticado" });
  try {
    const p = jwt.verify(token, SECRET) as any;
    if (p?.type !== "customer" || !p.customerId || !p.tenantId) throw new Error("invalid token");
    req.portal = { customerId: p.customerId, tenantId: p.tenantId, type: "customer" };
    next();
  } catch {
    return res.status(401).json({ message: "Sessão inválida" });
  }
};
app.get("/api/portal/me", portalAuth, asyncH(async (req: PortalRequest, res) => {
  const c = await prisma.customer.findFirst({ where: { id: req.portal!.customerId, tenantId: req.portal!.tenantId, portalEnabled: true }, select: { id: true, name: true, email: true } });
  if (!c) return res.status(401).json({ message: "Cliente inválido" });
  res.json(c);
}));
app.get("/api/portal/orders", portalAuth, asyncH(async (req: PortalRequest, res) => {
  res.json(await prisma.order.findMany({ where: { customerId: req.portal!.customerId, tenantId: req.portal!.tenantId }, include: { items: { include: { product: true } }, productionOrders: true }, orderBy: { createdAt: "desc" } }));
}));
app.get("/api/portal/artworks", portalAuth, asyncH(async (req: PortalRequest, res) => {
  res.json(await prisma.artwork.findMany({ where: { customerId: req.portal!.customerId, tenantId: req.portal!.tenantId }, orderBy: { createdAt: "desc" } }));
}));
app.get("/api/portal/artworks/:id/file", portalAuth, asyncH(async (req: PortalRequest, res) => {
  const a = await prisma.artwork.findFirst({ where: { id: req.params.id, customerId: req.portal!.customerId, tenantId: req.portal!.tenantId } });
  if (!a) return res.status(404).json({ message: "Arte não encontrada" });
  const file = path.basename(a.fileUrl);
  const full = path.join(uploads, file);
  if (!fs.existsSync(full)) return res.status(404).json({ message: "Arquivo não encontrado no servidor" });
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
  res.sendFile(full);
}));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (err?.name === "ZodError") return res.status(400).json({ message: "Dados inválidos", details: err.issues });
  if (err?.code === "P2002") return res.status(409).json({ message: "Já existe um registro com esses dados." });
  res.status(500).json({ message: "Erro interno do servidor" });
});

const server = app.listen(PORT, () => console.log(`API: http://localhost:${PORT}`));
const shutdown = async () => { server.close(); await prisma.$disconnect(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
