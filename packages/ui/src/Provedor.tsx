import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { temaClaro, temaEscuro } from './tema.js';

/**
 * Raiz visual da aplicacao: aplica o tema e expõe a alternancia claro/escuro.
 *
 * Blueprint secao 9: a lib visual fica encapsulada aqui. Uma tela do LAPATO
 * nunca importa `ThemeProvider` do MUI diretamente - importa deste pacote.
 */

type Modo = 'claro' | 'escuro';

interface ContextoTema {
  modo: Modo;
  alternar: () => void;
}

const Contexto = createContext<ContextoTema>({ modo: 'claro', alternar: () => {} });

export function useTema(): ContextoTema {
  return useContext(Contexto);
}

const CHAVE = 'lapato:tema';

export function ProvedorLapato({ children }: { children: ReactNode }) {
  const [modo, setModo] = useState<Modo>(() => {
    // Em ambiente sem `localStorage` (teste, render fora do navegador) o acesso
    // lanca; o tema claro e o padrao seguro.
    try {
      return localStorage.getItem(CHAVE) === 'escuro' ? 'escuro' : 'claro';
    } catch {
      return 'claro';
    }
  });

  const alternar = useCallback(() => {
    setModo((atual) => {
      const novo = atual === 'claro' ? 'escuro' : 'claro';
      try {
        localStorage.setItem(CHAVE, novo);
      } catch {
        // Preferencia nao persistida nao impede o uso.
      }
      return novo;
    });
  }, []);

  const valor = useMemo(() => ({ modo, alternar }), [modo, alternar]);

  return (
    <Contexto.Provider value={valor}>
      <ThemeProvider theme={modo === 'claro' ? temaClaro : temaEscuro}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </Contexto.Provider>
  );
}
