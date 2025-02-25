import { isPlatform } from '@ionic/react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { matchPath } from 'react-router-dom';
import { routeData } from '../app/router';
import { MemoryRoutedComponent } from '../components/util/link';
import { StackElementPathContext } from '../components/util/link/StackElementPathContext';
import { getFullPath } from '../util/etc';
import { useIsMobile } from './styleHooks';

export interface StackRouterContextType {
  history: string[];
  currentPath: string;
  index: number;
  push: (path: string) => void;
  pop: () => void;
  setRoot: (
    path: string,
    direction: 'forwards' | 'backwards' | 'inplace',
  ) => void;
  popN: (n: number) => void;
  getIonicStackHeight: () => number;
  canGoBack: () => boolean;
}

function saveStackRouterInfo(history: string[], currentIndex: number): void {
  // save in session storage, which is, in most cases, restored with ctrl+shift+t
  sessionStorage.setItem('stackRouterHistory', JSON.stringify(history));
  sessionStorage.setItem('stackRouterIndex', currentIndex.toString());
}

// Loads but also adds this current page we've just navigated to
function getInitialStackRouterInfo(currentPath: string): {
  index: number;
  history: string[];
} {
  const loadedStack = sessionStorage.getItem('stackRouterHistory');
  const loadedIndex = sessionStorage.getItem('stackRouterIndex');

  const history = loadedStack ? JSON.parse(loadedStack) : [];
  let index = loadedIndex ? parseInt(loadedIndex, 10) : -1;

  const navigation = performance.getEntriesByType('navigation');
  const navigationType =
    // @ts-ignore
    navigation.length > 0 ? navigation[0].type : 'navigate';
  const isReload = navigationType === 'reload';

  index++;
  if (!isReload) {
    history[index] = currentPath;
  }

  saveStackRouterInfo(history, index);

  return {
    history,
    index,
  };
}

const initialStackRouterInfo = getInitialStackRouterInfo(getFullPath());

type PushType = 'push' | 'setRoot';

export const useStackRouter = (
  ionNavRef: React.RefObject<HTMLIonNavElement>,
) => {
  const [stackRouterState, setStackRouterState] = useState<{
    index: number;
    history: string[];
    currentPath: string;
  }>({
    ...initialStackRouterInfo,
    currentPath: getFullPath(),
  });

  const isMobile = useIsMobile();
  const isIOS = useMemo(() => isMobile && isPlatform('ios'), [isMobile]);

  const stackRouter: StackRouterContextType = useMemo(() => {
    return {
      history: stackRouterState.history,
      currentPath: stackRouterState.currentPath,
      index: stackRouterState.index,
      // @ts-ignore
      getIonicStackHeight: (): number => ionNavRef.current?.views.length,
      push: (path: string, pushState = true) => {
        ionNavRef.current?.push(() => (
          <MemoryRoutedComponent routerLink={path} />
        ));

        setStackRouterState((state) => {
          const newIndex = state.index + 1;
          // Chop off anything past the new index
          const newHistory = state.history.slice(0, newIndex);
          newHistory.push(path);

          if (isIOS === false && pushState) {
            history.pushState(
              {
                index: newIndex,
                path: path,
                pushType: 'push',
              },
              '',
              path,
            );
          }

          saveStackRouterInfo(newHistory, newIndex);
          return {
            index: newIndex,
            history: newHistory,
            currentPath: path,
          };
        });
      },
      pop: () => {
        ionNavRef.current?.pop();
        setStackRouterState((state) => {
          if (state.index === 0) {
            throw new Error('Cannot pop off the root. Call setRoot instead.');
          }

          // We don't remove the index from the history, we just move the index back
          const newIndex = Math.max(state.index - 1, 0);
          saveStackRouterInfo(state.history, newIndex);
          return {
            index: newIndex,
            history: state.history,
            currentPath: state.history[newIndex],
          };
        });
      },
      popTo: (index: number) => {
        throw new Error('Not implemented ' + index);
      },
      popN: (n: number) => {
        // @ts-ignore
        const stackHeight: number = ionNavRef.current?.views.length;
        const newTopIndex = stackHeight - 1 - n;
        ionNavRef.current?.popTo(newTopIndex);

        setStackRouterState((state) => {
          const newIndex = Math.max(state.index - n, 0);
          saveStackRouterInfo(state.history, newIndex);
          return {
            index: newIndex,
            history: state.history,
            currentPath: state.history[newIndex],
          };
        });
      },
      setRoot: (
        path: string,
        direction: 'forwards' | 'backwards' | 'inplace',
      ) => {
        ionNavRef.current?.setRoot(() => (
          <MemoryRoutedComponent routerLink={path} />
        ));
        setStackRouterState((state) => {
          if (direction === 'forwards') {
            const newIndex = state.index + 1;
            const newHistory = [...state.history];
            newHistory[newIndex] = path;
            saveStackRouterInfo(newHistory, newIndex);

            if (isIOS === false) {
              history.pushState(
                {
                  index: newIndex,
                  path: path,
                  pushType: 'setRoot',
                },
                '',
                path,
              );
            }

            return {
              index: newIndex,
              history: newHistory,
              currentPath: path,
            };
          } else if (direction === 'backwards') {
            const newIndex = Math.max(state.index - 1, 0);
            const newHistory = [...state.history];
            newHistory[newIndex] = path;
            saveStackRouterInfo(state.history, newIndex);
            return {
              index: newIndex,
              history: state.history,
              currentPath: path,
            };
          } else {
            const newHistory = [...state.history];
            newHistory[newHistory.length - 1] = path;
            return {
              index: state.index,
              history: newHistory,
              currentPath: path,
            };
          }
        });
      },
      removeIndex: (index: number, count: number) => {
        ionNavRef.current?.removeIndex(index, count);

        setStackRouterState((state) => {
          const newStack = [...state.history];
          newStack.splice(index, count);
          const newIndex = Math.max(state.index - count, 0);
          return {
            index: newIndex,
            history: newStack,
            currentPath: newStack[newIndex],
          };
        });
      },
      canGoBack: () => {
        // @ts-ignore
        return ionNavRef.current?.canGoBackSync();
      },
    };
  }, [isIOS, stackRouterState, ionNavRef]);

  useEffect(() => {
    const onPopstate = (event: PopStateEvent) => {
      if (event.state) {
        const {
          index: newIndex,
          path,
          pushType,
        }: {
          index: number;
          path: string;
          pushType: PushType;
        } = event.state;
        // No state case
        if (newIndex === undefined || path === undefined) {
          throw new Error('Impossible');
        }
        // Going forwards
        if (newIndex > stackRouter.index) {
          if (pushType === 'setRoot') {
            stackRouter.setRoot(path, 'forwards');
          } else if (
            // If it's a different forward path, push it
            stackRouter.history[newIndex] !== path
          ) {
            stackRouter.push(path);
          } else {
            // If we know we'ere going to an index and trust it's there, push everything in between

            for (let i = stackRouter.index + 1; i <= newIndex; i++) {
              stackRouter.push(stackRouter.history[i]);
            }
          }
        } else if (newIndex < stackRouter.index) {
          // If we've refreshed, then we've cleared Ionic's stack, so the history may not match the stack
          const popAmount = stackRouter.index - newIndex;
          if (
            ((popAmount === 1 && stackRouter.canGoBack()) ||
              popAmount < stackRouter.getIonicStackHeight()) &&
            path === stackRouter.history[stackRouter.index - popAmount]
          ) {
            stackRouter.popN(popAmount);
          } else {
            {
              // If it's more than one off, set root on desktop
              if (!isMobile) {
                stackRouter.setRoot(path, 'backwards');
              }
            }
          }
        } else if (newIndex === stackRouter.index) {
          // If we're on the same index, just set root
          if (!isMobile) {
            if (newIndex === 0) {
              stackRouter.setRoot(getFullPath(), 'inplace');
            } else {
              stackRouter.setRoot(path, 'inplace');
            }
          }
        }
      } else {
        // If we don't have history, assume we're going backwards, and maybe ionic has something
        if (stackRouter.canGoBack()) {
          stackRouter.pop();
        } else {
          stackRouter.setRoot(getFullPath(), 'backwards');
        }
      }
    };

    window.addEventListener('popstate', onPopstate);

    return () => {
      window.removeEventListener('popstate', onPopstate);
    };
  }, [stackRouter, isMobile]);

  return stackRouter;
};

function getParams(url: string) {
  for (const path of Object.keys(routeData)) {
    const match = matchPath(url, {
      path,
      exact: true,
    });
    if (match) {
      return match.params;
    }
  }
  return {};
}

export function useLocation(): string {
  const memoryPath = useContext(StackElementPathContext);

  return memoryPath;
}

export function useParams<
  P extends { [K in keyof P]?: string | undefined },
>(): P {
  const location = useLocation();
  return useMemo(() => {
    return getParams(location) as P;
  }, [location]);
}
