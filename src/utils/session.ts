import { EmpresaSessao, Usuario } from '../types';

/**
 * Sessão do app e opção "Lembrar neste dispositivo".
 *
 * - Marcada: a sessão fica no localStorage (sobrevive ao fechar o navegador) e o
 *   usuário é guardado para vir preenchido no próximo login.
 * - Desmarcada: a sessão fica no sessionStorage (termina ao fechar o navegador).
 *
 * A sessão guarda só o token assinado pelo servidor. Com "Lembrar" marcado, o
 * usuário e a senha também ficam neste navegador (ver lerLembrete/salvarLembrete).
 */

const SESSAO = 'romaneio_sessao';
const LEMBRETE = 'romaneio_lembrar_login';

export interface Sessao {
  usuario: Usuario;
  /** Empresa do usuário (sys_usuarios.empresa_id ou a padrão do .env) */
  empresa: EmpresaSessao;
  token: string;
}

/** O acesso ao storage pode lançar exceção (modo privado, bloqueio de cookies) */
function seguro<T>(fn: () => T, padrao: T): T {
  try {
    return fn();
  } catch {
    return padrao;
  }
}

export function lerSessao(): Sessao | null {
  return seguro(() => {
    const bruto = localStorage.getItem(SESSAO) ?? sessionStorage.getItem(SESSAO);
    const s = bruto ? (JSON.parse(bruto) as Sessao) : null;
    return s?.token && s.usuario && s.empresa ? s : null;
  }, null);
}

export function salvarSessao(sessao: Sessao, lembrar: boolean) {
  seguro(() => {
    (lembrar ? localStorage : sessionStorage).setItem(SESSAO, JSON.stringify(sessao));
    // Evita que sobre uma cópia no armazenamento que não foi escolhido
    (lembrar ? sessionStorage : localStorage).removeItem(SESSAO);
  }, undefined);
}

/** Regrava a sessão no mesmo armazenamento em que já estava (ex.: permissões alteradas pelo administrador) */
export function atualizarSessao(sessao: Sessao) {
  seguro(() => salvarSessao(sessao, localStorage.getItem(SESSAO) != null), undefined);
}

export function limparSessao() {
  seguro(() => {
    localStorage.removeItem(SESSAO);
    sessionStorage.removeItem(SESSAO);
  }, undefined);
}

/**
 * Último acesso com "Lembrar neste dispositivo" marcado: usuário e senha.
 *
 * ATENÇÃO: a senha fica no localStorage deste navegador. O base64 só evita que ela
 * apareça legível de relance nas ferramentas do navegador — NÃO é criptografia: quem
 * tiver acesso ao computador (ou a uma extensão) consegue ler. Desmarcar a opção,
 * ou entrar com ela desmarcada, apaga o que estava guardado.
 */
export interface Lembrete {
  login: string;
  senha: string;
}

export function lerLembrete(): Lembrete | null {
  return seguro(() => {
    const bruto = localStorage.getItem(LEMBRETE);
    if (!bruto) return null;
    const l = JSON.parse(bruto) as { login?: string; senha?: string };
    return { login: String(l.login || ''), senha: l.senha ? decodeURIComponent(escape(atob(l.senha))) : '' };
  }, null);
}

export function salvarLembrete(login: string, senha: string) {
  seguro(
    () => localStorage.setItem(LEMBRETE, JSON.stringify({ login, senha: senha ? btoa(unescape(encodeURIComponent(senha))) : '' })),
    undefined,
  );
}

export function limparLembrete() {
  seguro(() => localStorage.removeItem(LEMBRETE), undefined);
}
