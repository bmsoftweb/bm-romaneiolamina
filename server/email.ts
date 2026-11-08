import nodemailer from 'nodemailer';

/**
 * Envio de e-mail por SMTP (botão e-Mail do romaneio), configurado no .env com os mesmos nomes dos outros
 * projetos: SMTP_HOST, SMTP_PORT (padrão 587), SMTP_USER, SMTP_PASS (ou SMTP_PASSWORD),
 * SMTP_FROM (padrão: o usuário), SMTP_SECURE=true para SSL direto (sem ela, só na 465)
 */
export async function enviarEmail(msg: { para: string; assunto: string; texto: string; anexos?: { nome: string; conteudo: Buffer }[] }) {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('E-mail não configurado: preencha SMTP_HOST, SMTP_USER e SMTP_PASS no .env do servidor.');
  const port = Number(process.env.SMTP_PORT) || 587;
  const s = process.env.SMTP_SECURE;
  const user = process.env.SMTP_USER;
  const transporte = nodemailer.createTransport({
    host,
    port,
    secure: s ? s === 'true' || s === '1' : port === 465,
    auth: user ? { user, pass: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD } : undefined,
  });
  await transporte.sendMail({
    from: process.env.SMTP_FROM || user,
    to: msg.para,
    subject: msg.assunto,
    text: msg.texto,
    attachments: msg.anexos?.map((a) => ({ filename: a.nome, content: a.conteudo })),
  });
}
