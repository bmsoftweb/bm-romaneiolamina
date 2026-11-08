import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, checkDbHealth } from './db.js';
import { createCrudRouter } from './crud.js';
import { createRomaneioRouter } from './romaneio.js';
import { createNFeRouter } from './nfe.js';

// ==========================================================
// Sessão: token "usuarioId.expiracao.assinatura" (HMAC-SHA256)
// ==========================================================
const SEGREDO =
  process.env.SESSION_SECRET ||
  (console.warn('SESSION_SECRET não definido: as sessões expiram a cada reinício do servidor.'),
  crypto.randomBytes(32).toString('hex'));
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

const assinar = (dados: string) => crypto.createHmac('sha256', SEGREDO).update(dados).digest('base64url');

function emitirToken(usuarioId: number): string {
  const dados = `${usuarioId}.${Date.now() + VALIDADE_MS}`;
  return `${dados}.${assinar(dados)}`;
}

/** Id do usuário do token, ou null se inválido/expirado */
function lerToken(token: string): number | null {
  const [id, exp, assinatura] = String(token || '').split('.');
  if (!id || !exp || !assinatura) return null;
  const esperada = assinar(`${id}.${exp}`);
  if (esperada.length !== assinatura.length || !crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(assinatura))) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(id);
}

const ehBcrypt = (hash: string) => /^\$2[aby]\$/.test(hash);

/** Validação de senha tolerante a bases legadas (como no crmweb): bcrypt, texto puro, MD5, SHA-256 e SHA-1 */
function senhaConfere(digitada: string, gravada: string): boolean {
  if (!gravada.trim()) return false;
  if (ehBcrypt(gravada)) {
    try {
      if (bcrypt.compareSync(digitada, gravada)) return true;
    } catch {
      // segue para os demais formatos
    }
  }
  if (digitada === gravada) return true;
  return ['md5', 'sha256', 'sha1'].some((alg) => crypto.createHash(alg).update(digitada).digest('hex') === gravada.toLowerCase());
}

/** Usuário ativo (sys_usuarios), a empresa dele (sys_empresas) e o perfil (sys_perfis) */
const SQL_USUARIO = `
  SELECT u.id, u.login, u.senha_hash,
         COALESCE(NULLIF(u.empresa_id, 0), ?) AS empresa_id,
         (SELECT COALESCE(NULLIF(e.nome_fantasia, ''), e.razao_social) FROM sys_empresas e WHERE e.id = COALESCE(NULLIF(u.empresa_id, 0), ?)) AS empresa_nome,
         (SELECT p.nome FROM sys_perfis p WHERE p.id = u.perfil_id) AS perfil
    FROM sys_usuarios u
   WHERE u.ativo = 1`;
const EMPRESA_PADRAO = Number(process.env.ID_EMPRESA) || 1;

const usuarioPublico = (u: any) => ({ id: String(u.id), nome: String(u.login), cargo: u.perfil || '' });
const empresaPublica = (u: any) => ({ id: String(u.empresa_id), nome: u.empresa_nome || `Empresa ${u.empresa_id}` });

/** App Express com todas as rotas /api. Local: server.ts adiciona o Vite e o listen; Vercel: api/index.ts */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // ==========================================================
  // Login: usuário (sys_usuarios.login, sem diferenciar maiúsculas) + senha
  // ==========================================================
  app.post('/api/login', async (req: Request, res: Response) => {
    try {
      const login = String(req.body?.login || '').trim();
      const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
      if (!login) return res.status(400).json({ success: false, error: 'Informe o seu usuário.' });

      const [rows] = await pool.query<any[]>(`${SQL_USUARIO} AND LOWER(TRIM(u.login)) = ? LIMIT 1`, [EMPRESA_PADRAO, EMPRESA_PADRAO, login.toLowerCase()]);
      if (!rows.length) return res.status(401).json({ success: false, error: `O usuário "${login}" não foi localizado ou está inativo.` });
      const u = rows[0];
      const gravada = String(u.senha_hash ?? '');

      // Senha em branco no banco = primeiro acesso: grava o que foi digitado em bcrypt
      let primeiroAcesso = false;
      if (!gravada.trim() || gravada.toUpperCase() === 'NULL') {
        if (senha.trim().length < 4) return res.status(401).json({ success: false, error: 'Primeiro acesso: defina uma senha com pelo menos 4 caracteres.' });
        await pool.query('UPDATE sys_usuarios SET senha_hash = ? WHERE id = ?', [bcrypt.hashSync(senha, 10), u.id]);
        primeiroAcesso = true;
      } else {
        if (!senhaConfere(senha, gravada)) return res.status(401).json({ success: false, error: 'Usuário/senha inválido(s).' });
        // Senha em formato legado passa para bcrypt
        if (!ehBcrypt(gravada)) await pool.query('UPDATE sys_usuarios SET senha_hash = ? WHERE id = ?', [bcrypt.hashSync(senha, 10), u.id]).catch(() => {});
      }
      await pool.query('UPDATE sys_usuarios SET ultimo_acesso = NOW() WHERE id = ?', [u.id]).catch(() => {});

      res.json({
        success: true,
        primeiroAcesso,
        message: primeiroAcesso ? 'Primeiro acesso: sua senha foi registrada.' : undefined,
        token: emitirToken(Number(u.id)),
        usuario: usuarioPublico(u),
        empresa: empresaPublica(u),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================
  // Daqui para baixo, toda rota /api exige um token válido
  // ==========================================================
  // O usuário é relido a cada requisição: desativado, perde o acesso na hora
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    const token = String(req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    const usuarioId = lerToken(token);
    if (!usuarioId) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    try {
      const [rows] = await pool.query<any[]>(`${SQL_USUARIO} AND u.id = ? LIMIT 1`, [EMPRESA_PADRAO, EMPRESA_PADRAO, usuarioId]);
      if (!rows.length) return res.status(401).json({ valida: false, error: 'Seu usuário não existe mais ou está inativo. Fale com o administrador.' });
      res.locals.usuarioId = usuarioId;
      res.locals.usuario = rows[0];
      res.locals.empresaId = Number(rows[0].empresa_id);
      next();
    } catch (err: any) {
      // Falha de banco não derruba a sessão: a tela mostra o erro
      res.status(503).json({ valida: null, error: err.message });
    }
  });

  /** Revalidação da sessão guardada no navegador; base = banco em uso (barra de status do Delphi) */
  app.get('/api/sessao', (_req: Request, res: Response) => {
    const u = res.locals.usuario;
    res.json({ valida: true, usuario: usuarioPublico(u), empresa: empresaPublica(u), base: process.env.MYSQL_DATABASE || 'bmerp_000000' });
  });

  // Diagnóstico do banco: só logado (mostra host e usuário do MySQL)
  app.get('/api/db/status', async (_req: Request, res: Response) => {
    res.json(await checkDbHealth());
  });

  // Preferências das listas (colunas, larguras, grade), por usuário em sys_usuarios.config_listas
  app.get('/api/config-listas', async (_req: Request, res: Response) => {
    try {
      const [rows] = await pool.query<any[]>('SELECT config_listas FROM sys_usuarios WHERE id = ?', [res.locals.usuarioId]);
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(rows[0]?.config_listas || '{}') || {};
      } catch {
        // conteúdo inválido no banco não impede a lista de abrir
      }
      res.json(config);
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.put('/api/config-listas', async (req: Request, res: Response) => {
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return res.status(400).json({ error: 'Configuração inválida.' });
    const texto = JSON.stringify(corpo);
    if (texto.length > 60000) return res.status(413).json({ error: 'Configuração muito grande.' });
    try {
      const [r] = await pool.query<any>('UPDATE sys_usuarios SET config_listas = ? WHERE id = ?', [texto, res.locals.usuarioId]);
      if (!r.affectedRows) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.use('/api', createCrudRouter());
  app.use('/api', createRomaneioRouter());
  app.use('/api', createNFeRouter());

  return app;
}
