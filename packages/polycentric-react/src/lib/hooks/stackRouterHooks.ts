import { useContext, useMemo } from 'react';
import { matchPath } from 'react-router-dom';
import { routeData } from '../app/router';
import { StackElementPathContext } from '../components/util/link/StackElementPathContext';

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

export function useLocation(): string {
    const memoryPath = useContext(StackElementPathContext);

    return memoryPath;
}

export function useParams<Params extends { [K in keyof Params]?: string }>():
    | Params
    | emptyObject {
    const location = useLocation();
    return useMemo(() => {
        return getParams(location);
    }, [location]);
}
