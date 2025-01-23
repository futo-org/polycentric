import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useCallback, useRef, useState } from 'react';
import { useBlobDisplayURL } from '../../../hooks/imageHooks';
import { MentionSuggestions } from '../../util/linkify';
import { TopicSuggestionBox } from '../TopicSuggestionBox';

// const startsWithSlash = /^\/.*/
// const hasNonAlphanumeric = /[^a-zA-Z0-9/]/

const TopicBox = ({
    topic,
    setTopic,
    disabled,
}: {
    topic: string;
    setTopic: (s: string) => void;
    disabled?: boolean;
}) => {
    // const [focused, setFocused] = useState(false)
    return (
        <div className="md:w-96 max-w-[calc(100vw-76px)] h-[3rem] relative ml-1">
            <input
                type="text"
                name="postTopic"
                autoComplete="off"
                list="autocompleteOff"
                placeholder="Topic"
                aria-autocomplete="none"
                className={`bg-transparent w-full h-full p-5 absolute text-lg placeholder:text-gray-300 focus:outline-none peer z-10 font-light text-gray-900 ${
                    disabled ? 'opacity-60' : ''
                }`}
                value={topic}
                onChange={(e) => {
                    const { value } = e.target;
                    setTopic(value);

                    //   if (e.currentTarget.selectionStart != null && e.currentTarget.selectionStart < 1) {
                    //     e.currentTarget.setSelectionRange(1, 1)
                    //   }

                    //   if (hasNonAlphanumeric.test(value)) {
                    //     value = value.replace(hasNonAlphanumeric, '')
                    //   }

                    //   if (startsWithSlash.test(value)) {
                    //     setTopic(value)
                    //   } else if (value === '') {
                    //     setTopic('/')
                    //   }
                    // }}
                    // onKeyDown={(e) => {
                    //   // prevent the user from moving the cursor before the slash
                    //   if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart != null && e.currentTarget.selectionStart === 1) {
                    //     e.preventDefault()
                    //   }
                    // }}
                    // onTouchStart={(e) => {
                    //   if (e.currentTarget.selectionStart != null && e.currentTarget.selectionStart < 1) {
                    //     e.currentTarget.setSelectionRange(1, 1)
                    //   }
                    // }}
                    // onClick={(e) => {
                    //   if (e.currentTarget.selectionStart != null && e.currentTarget.selectionStart < 1) {
                    //     e.currentTarget.setSelectionRange(1, 1)
                    //   }
                }}
                // onFocus={() => setFocused(true)}
                // onBlur={() => setFocused(false)}
                disabled={disabled}
            />
            <div
                className={`absolute top-0 left-0 w-full h-full border bg-white peer-focus:border-gray-400 rounded-lg -skew-x-[9deg] ${
                    disabled ? 'opacity-50' : ''
                }
        `}
            ></div>
            {/* Temporarily disabled */}
            {false && (
                // What, you've never seen a trig function in CSS before?
                <div className="absolute top-[3rem] w-full ml-[calc(-0.5_*_tan(9deg)_*_3rem)]">
                    <TopicSuggestionBox
                        topics={{}}
                        query={topic}
                        setSelected={(s) => {
                            setTopic(s);
                            // setFocused(false)
                        }}
                    />
                </div>
            )}
        </div>
    );
};

export const Compose = ({
    preSetTopic,
    hideTopic,
    onPost,
    topicDisabled = false,
    flexGrow = false,
    hfull = false,
    maxTextboxHeightPx = 440,
    minTextboxHeightPx = 125,
    postingProgress,
}: {
    onPost: (
        content: string,
        upload?: File,
        topic?: string,
    ) => Promise<boolean>;
    preSetTopic?: string;
    hideTopic?: boolean;
    topicDisabled?: boolean;
    flexGrow?: boolean;
    hfull?: boolean;
    maxTextboxHeightPx?: number;
    minTextboxHeightPx?: number;
    postingProgress?: number;
}) => {
    const [content, setContent] = useState('');
    const [topic, setTopic] = useState(preSetTopic ?? '');
    const [upload, setUpload] = useState<File | undefined>();
    const [mentionState, setMentionState] = useState<{
        active: boolean;
        position: { top: number; left: number };
        query: string;
        startIndex: number;
    } | null>(null);
    const textRef = useRef<HTMLTextAreaElement | null>(null);
    const uploadRef = useRef<HTMLInputElement | null>(null);

    const imageUrl = useBlobDisplayURL(upload);

    const post = useCallback(() => {
        onPost?.(content, upload, topic).then(() => {
            setContent('');
            setUpload(undefined);
            if (textRef.current)
                textRef.current.style.height = `${minTextboxHeightPx}px`;
        });
    }, [onPost, content, upload, minTextboxHeightPx, topic]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 'NumpadEnter')) {
            post();
        }
    }, [post]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newContent = e.target.value;
        const cursorPosition = e.target.selectionStart;
        setContent(newContent);

        // Handle textarea height
        if (flexGrow === false) {
            e.target.style.height = '0';
            let height = Math.max(
                minTextboxHeightPx,
                e.target.scrollHeight,
            );
            if (maxTextboxHeightPx !== 0) {
                height = Math.min(height, maxTextboxHeightPx);
            }
            e.target.style.height = `${height}px`;
        }
        
        // Check if we just typed @ or are in an active mention
        const textBeforeCursor = newContent.slice(0, cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    
        
        if (lastAtSymbol >= 0) {
            // Check if this @ is at a word boundary
            const charBeforeAt = textBeforeCursor[lastAtSymbol - 1];
            const isAtWordBoundary = !charBeforeAt || charBeforeAt === ' ' || charBeforeAt === '\n';

            if (isAtWordBoundary) {
                const query = textBeforeCursor.slice(lastAtSymbol + 1);
                const textAfterQuery = newContent.slice(cursorPosition);
                const isQueryValid = !query.includes(' ') && !query.includes('\n');

                if (isQueryValid) {
                    const rect = e.target.getBoundingClientRect();
                    const textareaStyle = window.getComputedStyle(e.target);
                    const lineHeight = parseInt(textareaStyle.lineHeight || '20');
                    const paddingLeft = parseInt(textareaStyle.paddingLeft || '0');
                    
                    // Get the current line's text
                    const lines = textBeforeCursor.split('\n');
                    const currentLineNumber = lines.length - 1;
                    
                    // Calculate position based on @ symbol location
                    const position = {
                        top: rect.top + (currentLineNumber * lineHeight) + lineHeight + window.scrollY,
                        left: rect.left + paddingLeft + (lastAtSymbol * 8) // Approximate character width
                    };

                    setMentionState({
                        active: true,
                        position,
                        query,
                        startIndex: lastAtSymbol
                    });
                } else {
                    setMentionState(null);
                }
            } else {
                setMentionState(null);
            }
        } else {
            setMentionState(null);
        }
    }, [mentionState, flexGrow, minTextboxHeightPx, maxTextboxHeightPx]);

    return (
        <div className={`flex flex-col ${flexGrow ? 'flex-grow' : ''} ${hfull ? 'h-full' : ''}`}>
            {hideTopic ? null : (
                <div className="flex-shrink-0">
                    <TopicBox
                        topic={topic}
                        setTopic={setTopic}
                        disabled={topicDisabled}
                    />
                </div>
            )}
            <div className={`flex flex-col mt-1.5 w-full border rounded-md focus-within:border-gray-300 overflow-visible relative ${
                flexGrow ? 'flex-grow' : ''
            }`}>
                <textarea
                    className={`w-full resize-none leading-normal whitespace-pre-line text-lg placeholder:text-gray-300 text-gray-900 font-normal rounded-lg p-3.5 focus:outline-none flex-grow bg-transparent`}
                    style={{ minHeight: minTextboxHeightPx + 'px' }}
                    value={content}
                    ref={textRef}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder="What's going on?"
                />
                {mentionState && (
                    <MentionSuggestions
                        query={mentionState.query}
                        position={mentionState.position}
                        onSelect={(username: string) => {
                            if (textRef.current) {
                                const beforeMention = content.slice(0, mentionState.startIndex);
                                const afterMention = content.slice(textRef.current.selectionStart);
                                const newContent = `${beforeMention}@${username} ${afterMention}`;
                                setContent(newContent);
                                
                                // Calculate new cursor position
                                const newCursorPosition = mentionState.startIndex + username.length + 2; // +2 for @ and space
                                setTimeout(() => {
                                    if (textRef.current) {
                                        textRef.current.focus();
                                        textRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
                                    }
                                }, 0);
                            }
                            setMentionState(null);
                        }}
                    />
                )}
                {upload && (
                    <div>
                        <div className="p-4 inline-block relative">
                            <img
                                className="max-h-[20rem] max-w-[20rem] rounded-sm inline-block border-gray-1000 border"
                                src={imageUrl}
                            />
                            <button
                                className="absolute top-5 right-5 "
                                onClick={() => setUpload(undefined)}
                            >
                                <XCircleIcon className="w-9 h-9 text-gray-300 hover:text-gray-400" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="w-full flex justify-between items-center pt-4">
                <div className="flex items-start space-x-4">
                    <button onClick={() => uploadRef.current?.click()}>
                        <PhotoIcon
                            className="w-9 h-9 text-gray-300 hover:text-gray-400"
                            strokeWidth="1"
                        />
                    </button>
                    <input
                        type="file"
                        className="hidden"
                        name="img"
                        accept="image/*"
                        ref={uploadRef}
                        onChange={(e) => {
                            const { files } = e.target;
                            if (files !== null && files.length > 0) {
                                setUpload(files[0]);
                            }
                        }}
                    />
                </div>
                <button
                    disabled={
                        (!content && !upload) ||
                        (postingProgress != null && postingProgress > 0)
                    }
                    className="bg-slate-50 hover:bg-slate-200 disabled:bg-white border disabled:text-gray-500 text-gray-800 rounded-full px-8 py-2 font-medium text-lg tracking-wide"
                    onClick={post}
                >
                    Post
                </button>
            </div>
        </div>
    );
};
