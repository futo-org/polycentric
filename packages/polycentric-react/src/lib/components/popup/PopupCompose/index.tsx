import { Models, Util } from '@polycentric/polycentric-core';
import { useCallback } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { publishImageBlob } from '../../../util/imageProcessing';
import { Compose } from '../../feed/Compose';
import { Modal } from '../../util/modal';

export const PopupCompose = ({
    onPost,
}: {
    onPost: (
        content: string,
        upload?: File | undefined,
        topic?: string | undefined,
    ) => Promise<boolean>;
}) => {
    return (
        <div className="md:px-7 bg-white overflow-clip flex flex-col space-y-0 w-auto md:w-[40rem]">
            <div>
                <Compose
                    onPost={onPost}
                    maxTextboxHeightPx={250}
                    minTextboxHeightPx={200}
                />
            </div>
        </div>
    );
};

export const PopupComposeFullscreen = ({
    open,
    setOpen,
}: {
    open: boolean;
    setOpen: (b: boolean) => void;
}) => {
    const { processHandle } = useProcessHandleManager();

    const onPost = useCallback(
        async (
            content: string,
            upload?: File,
            topic?: string,
        ): Promise<boolean> => {
            try {
                let imageBundle;
                if (upload) {
                    imageBundle = await publishImageBlob(upload, processHandle);
                }

                let topicReference;
                if (topic && topic.length > 0) {
                    const topicBuffer = Util.encodeText(topic);
                    topicReference = Models.bufferToReference(topicBuffer);
                }

                await processHandle.post(content, imageBundle, topicReference);
            } catch (e) {
                console.error(e);
                return false;
            }
            setOpen(false);
            return true;
        },
        [processHandle, setOpen],
    );

    return (
        <Modal open={open} setOpen={setOpen}>
            <PopupCompose onPost={onPost} />
        </Modal>
    );
};
