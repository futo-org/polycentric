// React Native integration test
import { createRNProcessHandle } from './index';
import * as Models from './models';

/**
 * This file provides a basic test/example of using the Polycentric library in React Native.
 * In a real application, you would import this library and use it in your React Native components.
 */

// Example function to initialize Polycentric in a React Native app
export async function initializePolycentric() {
  try {
    // Create a new process handle using the React Native persistence driver
    const processHandle = await createRNProcessHandle();
    
    // Set up profile information
    await processHandle.setUsername('ReactNativeUser');
    await processHandle.setDescription('Created with Polycentric on React Native');
    
    // Add a server for synchronization
    await processHandle.addServer('https://example-server.com');
    
    // Query some data
    processHandle.queryManager.queryCRDT.query(
      processHandle.system(),
      Models.ContentType.ContentTypeUsername,
      (state) => {
        if (state.value) {
          console.log('Username:', Models.Util.decodeText(state.value));
        }
      }
    );
    
    return processHandle;
  } catch (error) {
    console.error('Error initializing Polycentric:', error);
    throw error;
  }
}

// Example function to post content
export async function postContent(processHandle: any, content: string) {
  try {
    const pointer = await processHandle.post(content);
    console.log('Posted content with pointer:', pointer);
    
    // Trigger synchronization
    await processHandle.synchronizer.synchronizationHint();
    
    return pointer;
  } catch (error) {
    console.error('Error posting content:', error);
    throw error;
  }
}

// Example function to follow another user
export async function followUser(processHandle: any, systemPublicKey: any) {
  try {
    await processHandle.follow(systemPublicKey);
    console.log('Successfully followed user');
    
    // Trigger synchronization
    await processHandle.synchronizer.synchronizationHint();
  } catch (error) {
    console.error('Error following user:', error);
    throw error;
  }
}

// Example function to get a user's feed
export async function getUserFeed(processHandle: any, system: any) {
  return new Promise((resolve) => {
    const posts: any[] = [];
    
    processHandle.queryManager.queryLatest.query(
      system,
      [Models.ContentType.ContentTypePost],
      (state) => {
        for (const event of state.events) {
          const eventObj = Models.Event.fromBuffer(event.event);
          if (eventObj.content.length > 0) {
            const post = {
              id: Models.signedEventToPointer(event),
              content: Protocol.Post.decode(eventObj.content).content,
              timestamp: new Date(eventObj.unixMilliseconds?.toNumber() || 0)
            };
            posts.push(post);
          }
        }
        
        resolve(posts);
      }
    );
  });
}