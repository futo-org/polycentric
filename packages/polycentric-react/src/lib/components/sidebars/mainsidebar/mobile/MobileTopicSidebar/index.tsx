import { MinusIcon } from '@heroicons/react/24/outline';
import {
    IonItem,
    IonItemOption,
    IonItemOptions,
    IonItemSliding,
    IonMenuToggle,
} from '@ionic/react';
import { Models, Util } from '@polycentric/polycentric-core';
import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { MobileSwipeTopicContext } from '../../../../../app/contexts';
import { useProcessHandleManager } from '../../../../../hooks/processHandleManagerHooks';
import { useQueryCRDTSet } from '../../../../../hooks/queryHooks';
import { useTopicDisplayText } from '../../../../../hooks/utilHooks';
import { Link } from '../../../../util/link';
import './itemsliding.css';

const MobileTopicSidebarItem = ({ topic }: { topic: string }) => {
    const ionSlidingRef = useRef<HTMLIonItemSlidingElement>(null);

    const { processHandle } = useProcessHandleManager();

    const leaveTopic = useCallback(() => {
        processHandle.leaveTopic(topic);
    }, [processHandle, topic]);

    const { topic: currentTopic, setTopic } = useContext(
        MobileSwipeTopicContext,
    );

    const isCurrentTopic = useMemo(
        () => currentTopic === topic,
        [currentTopic, topic],
    );

    const displayTopic = useTopicDisplayText(topic);

    return (
        <IonItemSliding
            className="rounded overflow-hidden relative h-10 mb-2"
            ref={ionSlidingRef}
            // for future use, onIonDrag gives a custom event with property event.detail.ratio for the ratio of the drag
        >
            <IonItemOptions side="start">
                <IonItemOption color="light" onClick={leaveTopic}>
                    <MinusIcon className="w-6 h-6" />
                </IonItemOption>
            </IonItemOptions>

            <IonItem
                className="border-none [& .item-inner]:border-none p-0"
                style={{ borderStyle: 'none' }}
            >
                <IonMenuToggle className="contents">
                    <Link
                        onClick={() => setTopic(topic)}
                        className={`w-full h-full p-2 pl-4 hover:bg-[#f4f5f8] text-left overflow-hidden text-ellipsis whitespace-nowrap text-black ${
                            isCurrentTopic ? 'bg-gray-100' : ' bg-white'
                        }`}
                        routerLink="/"
                        routerDirection="root"
                        // no href so we can drag the item
                    >
                        {displayTopic}
                    </Link>
                </IonMenuToggle>
            </IonItem>
        </IonItemSliding>
    );
};

export const MobileTopicSidebar = () => {
    const { processHandle } = useProcessHandleManager();
    const system = useMemo(() => processHandle.system(), [processHandle]);
    const [joinedTopicEvents, advance] = useQueryCRDTSet(
        system,
        Models.ContentType.ContentTypeJoinTopic,
        30,
    );

    const joinedTopics = useMemo(() => {
        return Util.filterUndefined(
            joinedTopicEvents.map((event) => event.lwwElementSet?.value),
        ).map((value) => Util.decodeText(value));
    }, [joinedTopicEvents]);

    useEffect(() => {
        advance();
    }, [advance]);

    return (
        <>
            <h2 className="text-lg">Favorite Topics</h2>
            {joinedTopics.map((topic) => (
                <MobileTopicSidebarItem key={topic} topic={topic} />
            ))}
        </>
    );
};
