import {
    IonButtons,
    IonContent,
    IonHeader,
    IonMenu,
    IonMenuButton,
    IonPage,
    IonTitle,
    IonToolbar,
} from '@ionic/react';
import './style.css';

export const Drawer = ({
    title,
    children,
    side = 'left',
    contentId = 'main',
    type = 'reveal',
}: {
    title?: string;
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
        >
            <div className="flex h-full flex-col overflow-y-auto bg-white py-6 shadow-xl">
                <div className="px-4 sm:px-6">
                    <h2 className="text-base font-semibold leading-6 text-gray-900">
                        {title}
                    </h2>
                </div>
                <div className="relative mt-6 flex-1 px-4 sm:px-6">
                    {children}
                </div>
            </div>
        </IonMenu>
    );
};

export const DrawerTest = () => (
    <>
        <Drawer contentId="main-content" title="Menu" />
        <IonPage id="main-content">
            <IonHeader>
                <IonToolbar>
                    <IonButtons slot="start">
                        <IonMenuButton></IonMenuButton>
                    </IonButtons>
                    <IonTitle>Menu</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
                Tap the button in the toolbar to open the menu.
            </IonContent>
        </IonPage>
    </>
);
