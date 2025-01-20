import { Models, Util } from '@polycentric/polycentric-core';
import { useCallback, useState } from 'react';
import { Compose } from '..';
import { useProcessHandleManager } from '../../../../hooks/processHandleManagerHooks';
import { publishImageBlob } from '../../../../util/imageProcessing';

export const PostCompose = () => {
    const { processHandle } = useProcessHandleManager();

    const [postingProgress, setPostingProgress] = useState(0);

    const onPost = useCallback(
        async (
            content: string,
            upload?: File,
            topic?: string,
        ): Promise<boolean> => {
            try {
                setPostingProgress(0.1);
                let imageBundle;
                if (upload) {
                    imageBundle = await publishImageBlob(upload, processHandle);
                }
                setPostingProgress(0.5);

                let topicReference;
                if (topic && topic.length > 0) {
                    if (topic.startsWith('/')) topic = topic.slice(1);
                    const topicBuffer = Util.encodeText(topic);
                    topicReference = Models.bufferToReference(topicBuffer);
                }

                await processHandle.post(content, imageBundle, topicReference);

                setPostingProgress(1);
                setTimeout(() => {
                    setPostingProgress(0);
                }, 100);
            } catch (e) {
                console.error(e);
                setPostingProgress(0);
                return false;
            }
            return true;
        },
        [processHandle],
    );

    return (
        <div className="border-b bg-white">
            <div className="py-3 lg:p-10">
                <Compose onPost={onPost} postingProgress={postingProgress} />
            </div>
            {postingProgress > 0 && (
                <div
                    style={{
                        height: '4px',
                        width: `${postingProgress * 100}%`,
                    }}
                    className="bg-blue-500"
                ></div>
            )}
        </div>
    );
};
