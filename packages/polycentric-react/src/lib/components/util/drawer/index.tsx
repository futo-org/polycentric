import { IonMenu } from '@ionic/react';
import './style.css';

export const Drawer = ({
    children,
    side = 'left',
    contentId = 'main',
    type = 'reveal',
}: {
    children?: React.ReactNode;
    side?: 'left' | 'right';
    contentId?: string;
    type?: 'reveal' | 'push' | 'overlay';
}) => {
    return (
        <IonMenu
            side={side === 'left' ? 'start' : 'end'}
            type={type}
            contentId={contentId}
            // maxEdgeStart={10000}
        >
            <div className="flex h-full flex-col overflow-y-auto bg-white py-6 shadow-xl">
                <div className="relative mt-6 flex-1 px-4 sm:px-6">
                    {children}
                </div>
            </div>
        </IonMenu>
    );
};
