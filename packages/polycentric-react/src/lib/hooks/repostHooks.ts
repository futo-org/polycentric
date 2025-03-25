import { Models, Protocol } from '@polycentric/polycentric-core';
import { useEffect, useState } from 'react';
import { useAvatar } from './imageHooks';
import { useProcessHandleManager } from './processHandleManagerHooks';
import { useSystemLink, useTextPublicKey, useUsernameCRDTQuery } from './queryHooks';

export function useRepostedPost(pointer?: Models.Pointer.Pointer) {
  const [content, setContent] = useState<string | null>(null);
  const [author, setAuthor] = useState<Models.PublicKey.PublicKey | null>(null);
  const { processHandle } = useProcessHandleManager();
  
  useEffect(() => {
    if (!pointer || !processHandle) return;
    
    let isCancelled = false;
    
    const loadRepostedContent = async () => {
      try {
        // Get the signed event directly from the store
        const signedEvent = await processHandle.store().indexEvents.getSignedEvent(
          pointer.system,
          pointer.process,
          pointer.logicalClock
        );

        if (isCancelled || !signedEvent) return;
        
        // Process the event data
        const eventData = Models.Event.fromBuffer(signedEvent.event);

        // Handle different content types
        if (eventData.contentType.equals(Models.ContentType.ContentTypePost)) {
          const post = Protocol.Post.decode(eventData.content);
          setContent(post.content || '');
        } else if (eventData.contentType.equals(Models.ContentType.ContentTypeClaim)) {
          const claim = Protocol.Claim.decode(eventData.content);
          setContent(`Claim: ${claim.claimFields?.[0]?.value || ''}`);
        } else {
          setContent('Other content type');
        }
        
        setAuthor(pointer.system);
      } catch (err) {
        console.error('Error loading reposted content:', err);
      }
    };
    
    loadRepostedContent();
    
    return () => {
      isCancelled = true;
    };
  }, [pointer, processHandle]);
  
  const authorName = author ? useUsernameCRDTQuery(author) : '';
  const authorAvatar = author ? useAvatar(author) : '';
  const authorURL = author ? useSystemLink(author) : '';
  const authorPubkey = author ? useTextPublicKey(author, 10) : '';
  
  return pointer && content ? {
    content,
    authorName,
    authorAvatar,
    authorURL,
    authorPubkey,
  } : null;
} 