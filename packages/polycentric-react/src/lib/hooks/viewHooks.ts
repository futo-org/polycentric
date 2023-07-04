import { useState, useEffect, useRef, createContext, useContext } from "react";
import * as Core from "@polycentric/polycentric-core";

// Since we create views based on the driver passed in, we set the view value at the root of the app. 
// With this, it will never be undefined - but since typescript doesn't know that, we ignore the error.
// @ts-ignore
export const ViewContext = createContext<View.View>();

export function useView(): Core.View.View {
    return useContext(ViewContext);
}

export function useCRDTQuery(contentType: Core.Models.ContentType.ContentType, system: Core.Models.PublicKey.PublicKey): Uint8Array | undefined {

    const [data, setData] = useState<Uint8Array | undefined>();
    const canceled = useRef(false);

    const view = useView();

    useEffect(() => {
        const unregister = view.registerCRDTQuery(
            system,
            contentType,
            (buffer: Uint8Array) => {
                if (canceled.current === false) {
                    setData(buffer);
                }
            },
        )

        return () => {
            canceled.current = true;
            unregister();
        }
    }, [])

    return data;
}