import { useCallback, useEffect, useState } from 'react';
import { Usuario, ResourceDef, RegistroCrud } from './types';
import { setTokenSessao, setAoExpirarSessao, fetchResources, invalidateOptions, validarSessao } from './services/api';
import { limparConfigListas } from './utils/configListas';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { CrudView } from './components/CrudView';
import { AcoesRomaneio } from './components/AcoesRomaneio';
import { ConfigNFeView } from './components/ConfigNFeView';
import { AvisoErro, NoCanto } from './components/AvisoErro';
import { TELAS_EXTRAS } from './utils/menu';
import { ThemeMode, getInitialTheme, applyTheme } from './utils/theme';
import { Sessao, lerSessao, salvarSessao, limparSessao, atualizarSessao } from './utils/session';

const TELA_INICIAL = 'romaneios';

/**
 * Romaneio concluído (como no Delphi) ou com NF-e gerada não muda mais; NF-e em rascunho ou rejeitada
 * ainda libera, para corrigir e gerar de novo (a mesma regra do travar() de server/romaneio.ts)
 */
const romaneioTravado = (row: RegistroCrud) =>
  row.status === 'C'
    ? 'Romaneio concluído: não é mais possível alterá-lo nem mexer nos itens.'
    : row.nfe_situacao && !['rascunho', 'rejeitada'].includes(String(row.nfe_situacao))
    ? 'Romaneio com NF-e gerada: não é mais possível alterá-lo nem mexer nos itens.'
    : null;

export default function App() {
  // ----------------------------------------------------------
  // Tema claro / escuro
  // ----------------------------------------------------------
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const handleToggleTheme = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), []);

  // ----------------------------------------------------------
  // Sessão (token assinado pelo servidor, guardado no navegador)
  // ----------------------------------------------------------
  const [sessao, setSessao] = useState<Sessao | null>(() => {
    const s = lerSessao();
    // O token precisa estar no cliente HTTP antes da primeira chamada
    setTokenSessao(s?.token ?? null);
    return s;
  });
  const usuario: Usuario | null = sessao?.usuario ?? null;
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);
  /** Banco em uso, na barra de status (como no Delphi) */
  const [base, setBase] = useState('');

  // ----------------------------------------------------------
  // Navegação e estado geral
  // ----------------------------------------------------------
  const [activeTab, setActiveTab] = useState(TELA_INICIAL);
  /** Telas já abertas continuam montadas: trocar de tela não fecha as abas de registro */
  const [telasMontadas, setTelasMontadas] = useState<string[]>([TELA_INICIAL]);
  const navegar = useCallback((tela: string) => {
    setActiveTab(tela);
    setTelasMontadas((m) => (m.includes(tela) ? m : [...m, tela]));
  }, []);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [resources, setResources] = useState<ResourceDef[]>([]);
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});

  const [refreshToken, setRefreshToken] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);
  const [erroTelas, setErroTelas] = useState<string | null>(null);

  const handleLogout = useCallback(() => {
    setSessao(null);
    setResources([]);
    setRecordCounts({});
    setActiveTab(TELA_INICIAL);
    setTelasMontadas([TELA_INICIAL]);
    invalidateOptions();
    setTokenSessao(null);
    limparConfigListas();
    limparSessao();
  }, []);

  // Qualquer 401 da API (token expirado, usuário apagado) volta para o login
  useEffect(() => {
    setAoExpirarSessao((msg) => {
      handleLogout();
      setAvisoLogin(msg);
    });
    return () => setAoExpirarSessao(null);
  }, [handleLogout]);

  // Sessão guardada no navegador é conferida ao abrir e ao voltar para a aba
  useEffect(() => {
    if (!sessao) return;
    const conferir = () =>
      validarSessao().then(({ valida, error, usuario: atual, empresa, base: banco }) => {
        if (valida === false) {
          handleLogout();
          setAvisoLogin(error || 'Sua sessão expirou. Entre novamente.');
          return;
        }
        if (banco) setBase(banco);
        if (atual && empresa) {
          setSessao((s) => {
            if (!s || JSON.stringify([s.usuario, s.empresa]) === JSON.stringify([atual, empresa])) return s;
            const nova = { ...s, usuario: atual, empresa };
            atualizarSessao(nova);
            return nova;
          });
        }
      });
    conferir();
    window.addEventListener('focus', conferir);
    return () => window.removeEventListener('focus', conferir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.token]);

  // Metadados dos recursos
  useEffect(() => {
    if (!sessao) return;
    let alive = true;
    fetchResources()
      .then((list) => alive && setResources(list))
      .catch((err) => setErroTelas(`Falha ao carregar as telas: ${err.message}`));
    return () => {
      alive = false;
    };
  }, [sessao?.token]);

  const handleCountChange = useCallback((resourceName: string, total: number) => {
    setRecordCounts((prev) => (prev[resourceName] === total ? prev : { ...prev, [resourceName]: total }));
  }, []);

  // ----------------------------------------------------------
  // 1. Tela de login
  // ----------------------------------------------------------
  if (!sessao || !usuario) {
    return (
      <LoginView
        avisoInicial={avisoLogin}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onLoginSuccess={(novoUsuario, empresa, token, lembrar) => {
          const nova = { usuario: novoUsuario, empresa, token };
          setTokenSessao(token);
          setSessao(nova);
          navegar(TELA_INICIAL);
          salvarSessao(nova, lembrar);
          setAvisoLogin(null);
          showToast(`Bem-vindo, ${novoUsuario.nome}!`);
        }}
      />
    );
  }

  // ----------------------------------------------------------
  // 2. Aplicação
  // ----------------------------------------------------------
  const recursoAtivo = resources.find((r) => r.name === activeTab);
  const telaExtra = TELAS_EXTRAS.find((t) => t.id === activeTab);

  const conteudoTela = (tela: string) => {
    if (tela === 'config_nfe') return <ConfigNFeView onToast={showToast} />;
    const resource = resources.find((r) => r.name === tela);
    if (!resource) {
      return <div className="py-24 text-center text-sm text-stone-500 dark:text-stone-400">Carregando a estrutura da tela…</div>;
    }
    const ehRomaneio = tela === 'romaneios';
    return (
      <CrudView
        resource={resource}
        allResources={resources}
        refreshToken={refreshToken}
        onToast={showToast}
        onCountChange={handleCountChange}
        onNavigate={navegar}
        acoesLinha={ehRomaneio ? (row, { recarregar }) => <AcoesRomaneio row={row} recarregar={recarregar} onToast={showToast} /> : undefined}
        acoesEmMenu={ehRomaneio}
        travado={ehRomaneio ? romaneioTravado : undefined}
      />
    );
  };

  return (
    <div className="h-screen overflow-hidden bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex font-sans antialiased selection:bg-blue-600 selection:text-white">
      {erroTelas && <AvisoErro mensagem={erroTelas} onFechar={() => setErroTelas(null)} />}
      {toastMessage && (
        <NoCanto>
          <div className="pointer-events-auto bg-stone-900 text-white text-xs font-semibold py-3 px-4 rounded-xl shadow-2xl border border-stone-800 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        </NoCanto>
      )}

      <Sidebar
        activeTab={activeTab}
        setActiveTab={navegar}
        resources={resources}
        recordCounts={recordCounts}
        usuario={usuario}
        onLogout={handleLogout}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Header
          empresaNome={sessao.empresa.nome}
          title={recursoAtivo?.label || telaExtra?.label || 'Romaneio de Lâminas'}
          subtitle={recursoAtivo?.description || telaExtra?.descricao || ''}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onRefresh={() => setRefreshToken((t) => t + 1)}
        />

        {telasMontadas.map((t) => (
          <div key={t} className={t === activeTab ? 'flex-1 flex flex-col min-h-0 min-w-0' : 'hidden'}>
            {conteudoTela(t)}
          </div>
        ))}

        {/* Barra de status (a do Delphi): versão, base, empresa e usuário */}
        <footer className="h-6 shrink-0 px-4 flex items-center gap-4 overflow-hidden whitespace-nowrap border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-[10px] text-stone-500 dark:text-stone-400">
          <span>Versão {__APP_VERSION__}</span>
          {base && <span>Base: {base}</span>}
          <span className="truncate">Empresa: {sessao.empresa.nome}</span>
          <span className="truncate">Usuário: {usuario.nome}</span>
        </footer>
      </div>
    </div>
  );
}
