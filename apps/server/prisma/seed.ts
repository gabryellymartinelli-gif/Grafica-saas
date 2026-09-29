import {PrismaClient,UserRole} from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma=new PrismaClient();
async function main(){
 const passwordHash=await bcrypt.hash("123456",10);
 const tenant=await prisma.tenant.upsert({where:{document:"00.000.000/0001-00"},update:{},create:{name:"Gráfica Demo",document:"00.000.000/0001-00"}});
 await prisma.user.upsert({where:{tenantId_email:{tenantId:tenant.id,email:"admin@grafica.local"}},update:{passwordHash},create:{tenantId:tenant.id,name:"Administrador",email:"admin@grafica.local",passwordHash,role:UserRole.ADMIN}});
 const ps=[["CV-4X4","Cartão de visita 4x4","MIL",45,90],["FLY-A5","Flyer A5 4x4","MIL",80,160],["BAN-90","Banner 90x60","UN",28,55]];
 for(const [code,name,unit,cost,price] of ps as any){const p=await prisma.product.upsert({where:{tenantId_code:{tenantId:tenant.id,code}},update:{},create:{tenantId:tenant.id,code,name,unit,cost,price}});await prisma.stockItem.upsert({where:{productId:p.id},update:{},create:{tenantId:tenant.id,productId:p.id,quantity:100,minimum:10}})}
 const portalHash=await bcrypt.hash("123456",10);
 const existingCustomer=await prisma.customer.findFirst({where:{tenantId:tenant.id,email:"cliente@example.com"}});
 const c=existingCustomer
   ? await prisma.customer.update({where:{id:existingCustomer.id},data:{portalEnabled:true,portalPasswordHash:portalHash,name:"Cliente Exemplo",phone:"(43) 99999-0000",city:"Arapongas",state:"PR"}})
   : await prisma.customer.create({data:{tenantId:tenant.id,name:"Cliente Exemplo",email:"cliente@example.com",phone:"(43) 99999-0000",city:"Arapongas",state:"PR",portalEnabled:true,portalPasswordHash:portalHash}});
 console.log("Seed concluído. Portal: cliente@example.com / 123456");
}
main().finally(()=>prisma.$disconnect());
