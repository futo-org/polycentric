import { useContext, useMemo } from 'react';
import { matchPath, useLocation as useRouterLocation } from 'react-router-dom';
import { routeData } from '../app/router';
import { MemoryRoutedLinkContext } from '../components/util/link/routedmemorylinkcontext';

function getParams(url: string) {
    for (const path of Object.keys(routeData)) {
        const match = matchPath(url, { path, exact: true });
        if (match) {
            return match.params;
        }
    }
    return {};
}

type emptyObject = { [key: string]: never };

export function useLocation() {
    const memoryPath = useContext(MemoryRoutedLinkContext);
    const reactRouterPath = useRouterLocation();

    return useMemo(
        () =>
            memoryPath ??
            reactRouterPath.pathname +
                reactRouterPath.hash +
                reactRouterPath.search,
        [memoryPath, reactRouterPath],
    );
}

export function useParams<Params extends { [K in keyof Params]?: string }>():
    | Params
    | emptyObject {
    const location = useLocation();
    return useMemo(() => {
        return getParams(location);
    }, [location]);
}
