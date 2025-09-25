# Polycentric React Feed Architecture

This document provides a comprehensive overview of how the feed system works in the Polycentric React library, including the design decisions, data flow, and implementation details for each feed type.

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [Feed Types](#feed-types)
  - [Author Feed](#author-feed)
  - [Explore Feed](#explore-feed)
  - [Search Posts Feed](#search-posts-feed)
  - [Reference Feed](#reference-feed)
  - [Topic Feed](#topic-feed)
  - [Comment Feed](#comment-feed)
  - [Following Feed](#following-feed)
  - [Likes Feed](#likes-feed)
  - [Replies Feed](#replies-feed)
- [Data Flow](#data-flow)
- [Performance Optimizations](#performance-optimizations)
- [Error Handling](#error-handling)

## Overview

The Polycentric React feed system is built on a sophisticated architecture that handles real-time, distributed content synchronization. The system uses CRDTs (Conflict-free Replicated Data Types) for data consistency and implements several key design patterns:

- **Content Type Separation**: Different content types (posts, claims, vouches) are handled independently
- **Moderation Filtering**: Real-time content filtering based on user preferences and blocked topics
- **Race Condition Prevention**: AsyncLock and CancelContext patterns prevent concurrent operation issues
- **Infinite Scroll**: Efficient pagination with cursor-based loading
- **Real-time Updates**: Observable patterns for live data synchronization

## Core Concepts

### FeedItem Types

```typescript
export type FeedItem =
  | ParsedEvent<Protocol.Post>
  | ParsedEvent<Protocol.Claim>
  | ParsedEvent<Protocol.Vouch>;
```

All feeds work with `ParsedEvent` objects that contain:
- `signedEvent`: The original signed event from the network
- `event`: The decoded event data
- `value`: The parsed content (Post, Claim, or Vouch)

### Feed Hook Pattern

```typescript
export type FeedHook = (
  ...args: any[]
) => [FeedHookData, FeedHookAdvanceFn, boolean?];
```

All feed hooks return:
- `FeedHookData`: Array of feed items
- `FeedHookAdvanceFn`: Function to load more content
- `boolean`: Optional "nothing found" state

## Feed Types

### Author Feed

**Purpose**: Displays all content from a specific user (posts, claims, vouches)

**Key Features**:
- **Content Type Separation**: Maintains separate hooks for posts, claims, and vouches
- **Independent Synchronization**: Each content type can be paginated independently
- **Chronological Sorting**: Combines all content types and sorts by timestamp

**Implementation**:
```typescript
export const useAuthorFeed: FeedHook = (system: Models.PublicKey.PublicKey) => {
  const [posts, advancePosts] = useIndex(system, ContentTypePost, Protocol.Post.decode);
  const [claims, advanceClaims] = useIndex(system, ContentTypeClaim, Protocol.Claim.decode);
  const [vouches, advanceVouches] = useIndex(system, ContentTypeVouch, Protocol.Vouch.decode);
  
  // Combine and sort by timestamp
  const allItems = useMemo(() => {
    const items = [...posts, ...claims, ...vouches].filter(item => item !== undefined);
    items.sort((a, b) => b.event.unixMilliseconds.toNumber() - a.event.unixMilliseconds.toNumber());
    return items;
  }, [posts, claims, vouches]);
  
  return [allItems, advance, false];
};
```

**Why Separate Hooks?**
- Independent synchronization prevents one content type from blocking others
- Allows for different loading states per content type
- Decoding for each type is handled separately

### Explore Feed

**Purpose**: Shows public posts from all users with moderation filtering. 

**Key Features**:
- **Moderation Integration**: Filters content based on user's moderation settings
- **Blocked Topic Filtering**: Real-time filtering of blocked topics
- **Comment Filtering**: Excludes comments (posts that reference other posts)
- **CRDT-based Blocking**: Uses CRDT sets for real-time blocked topic updates
- **Server-side Moderation**: Only feed with server-side moderation filtering

**IMPORTANT: This is the ONLY feed with moderation filtering due to data access constraints:**

**Why Only Explore Feed Has Moderation?**
- **All posts contain moderation info**: Every `signedEvent` has `moderationTags` with moderation metadata
- **Explore Feed**: Gets posts with full moderation tags from server via `makeGetExploreCallback`
- **Other Feeds**: Use client-side data sources (`useIndex`, `useQueryCursor`, `useReferenceFeed`) that don't include moderation tags
- **Server handles moderation**: Server processes moderation and includes tags, client filters based on user preferences

**Technical Implementation**:
```typescript
// Explore feed gets posts with moderation tags from server
const loadCallback = useMemo(
  () => Queries.QueryCursor.makeGetExploreCallback(
    queryManager.processHandle,
    moderationLevels, // ← Server includes moderation tags in response
  ),
  [queryManager.processHandle, moderationLevels],
);

// Client-side filtering using moderation tags
const failsModerationSettings = moderationLevels
  ? Object.entries(moderationLevels).some(([settingName, settingLevel]) => {
      return signedEvent.moderationTags.some(
        (tag) => tag.name === settingName && tag.level > settingLevel,
      );
    })
  : false;

// Other feeds use client-side data sources without moderation tags
const [posts, advancePosts] = useIndex(system, ContentTypePost, Protocol.Post.decode);
// ↑ These don't include moderation tags, so can't filter
```

**Why This Architecture?**
1. **Data Access**: Only explore feed gets posts with moderation tags from server
2. **Client-side Filtering**: Client uses moderation info to filter what it doesn't want to see
3. **Server Processing**: Server handles moderation analysis and includes tags in response

**Implementation Flow**:
1. Load user's blocked topics from CRDT set
2. Create explore callback with moderation levels
3. Filter out comments and blocked topic references
4. Return filtered feed data

**Blocked Topic Processing**:
```typescript
const blockedTopics = useMemo(() => {
  return blockedTopicEvents
    .filter((e) => e.lwwElementSet?.value)
    .map((e) => Util.decodeText(e.lwwElementSet!.value));
}, [blockedTopicEvents]);

const filteredData = useMemo(() => {
  return data.filter((item) => {
    // Filter out comments
    const hasPostReference = references.some((ref) => ref.referenceType.eq(2));
    if (hasPostReference) return false;
    
    // Filter out blocked topics
    for (const ref of references) {
      const text = Util.decodeText(ref.reference);
      if (blockedSet.has(text)) return false;
    }
    return true;
  });
}, [data, blockedSet]);
```

### Search Posts Feed

**Purpose**: Searches for posts containing specific text

**Key Features**:
- **Query Validation**: Minimum 3-character query length to prevent excessive API calls
- **Debounced Search**: Optimizes API usage with query validation
- **Search Type Support**: Uses `APIMethods.SearchType.Messages` for post-specific search

**Implementation**:
```typescript
const makeGetSearchCallbackWithMinQueryLength = (
  searchQuery: string,
  searchType: APIMethods.SearchType,
  minQueryLength: number,
) => {
  if (searchQuery.length < minQueryLength) {
    return async () => Models.ResultEventsAndRelatedEventsAndCursor.fromEmpty();
  }
  return Queries.QueryCursor.makeGetSearchCallback(searchQuery, searchType);
};
```

### Reference Feed

**Purpose**: Generic feed for content referencing a specific pointer

**Key Features**:
- **Flexible Reference Types**: Can handle any type of reference
- **Extra Byte References**: Supports additional reference formats
- **Protocol Integration**: Uses `useQueryReferenceEventFeed` for server communication

**Use Cases**:
- Comment feeds (posts referencing a specific post)
- Topic feeds (posts referencing a specific topic)
- User feeds (posts referencing a specific user)

### Topic Feed

**Purpose**: Shows posts related to a specific topic with alternate representations

**Key Features**:
- **Topic Normalization**: Handles different topic formats (URLs, plain text)
- **Alternate Representations**: Supports multiple ways to reference the same topic
- **Reference Generation**: Converts topics to protocol references

**Implementation**:
```typescript
export const useTopicFeed = (
  topic: string,
  alternateTopicRepresentations?: string[],
) => {
  const reference = useMemo(() => {
    return Models.bufferToReference(Util.encodeText(topic));
  }, [topic]);

  const extraByteReferences = useMemo(() => {
    return alternateTopicRepresentations?.map((topic) => Util.encodeText(topic));
  }, [alternateTopicRepresentations]);

  return useReferenceFeed(reference, extraByteReferences);
};
```

**Alternate Representations Example**:
- YouTube URL: `https://www.youtube.com/watch?v=abc123`
- YouTube ID: `abc123`
- Both reference the same content but in different formats

### Comment Feed

**Purpose**: Shows comments and replies for a specific post with backwards chain traversal

**Key Features**:
- **Backwards Chain Traversal**: Follows comment chains backwards to show full context
- **Duplicate Prevention**: Prevents duplicate comments in the chain
- **Reference Processing**: Handles post references to build comment threads
- **Prepend Count**: Tracks how many items were prepended from the backwards chain

**Complex Implementation**:
```typescript
const fetchAndPrepend = (pointer: Models.Pointer.Pointer) => {
  fetchPost(pointer.system, pointer.process, pointer.logicalClock, cancelContext, (signedEvent) => {
    const postReference = signedEvent.event.references.find((ref) => ref.referenceType.eq(2));
    if (postReference) {
      const postPointer = Models.Pointer.fromProto(Protocol.Pointer.decode(postReference.reference));
      fetchAndPrepend(postPointer); // Recursive traversal
    }
  });
};
```

**Data Flow**:
1. Start with the target post
2. Find comments referencing that post
3. For each comment, find comments referencing it
4. Continue recursively to build full comment chain
5. Combine backwards chain with direct comments

### Following Feed

**Purpose**: Shows posts from users that the current user follows

**Key Features**:
- **AsyncLock Integration**: Prevents race conditions during concurrent operations
- **Batch Processing**: Loads content in configurable batches
- **Content Type Support**: Handles both posts and claims
- **Chronological Sorting**: Sorts by timestamp across all followed users

**Race Condition Prevention**:
```typescript
const lock = new AsyncLock();

const adv = async () => {
  await lock.acquire('', async (): Promise<void> => {
    if (finished === true || cancelContext.cancelled()) return;
    // Process batch...
  });
};
```

**Batch Processing**:
- Loads content in batches (default 10 items)
- Continues loading until batch size is reached or no more content
- Sorts all content by timestamp after each batch

### Likes Feed

**Purpose**: Shows posts that the user has liked

**Key Features**:
- **Opinion Processing**: Processes like/dislike opinions from CRDT sets
- **Pointer Validation**: Handles malformed references gracefully
- **Error Recovery**: Continues processing even when some references are invalid
- **Deduplication**: Prevents duplicate posts in the feed

**Error Handling**:
```typescript
let pointer: Models.Pointer.Pointer | undefined;
try {
  pointer = Models.Pointer.fromProto(Protocol.Pointer.decode(opinion.event.references[0].reference));
} catch (err) {
  console.warn('Skipping opinion with invalid pointer:', err);
  return; // Skip this opinion
}
```

**Processing Flow**:
1. Load user's opinions from CRDT set
2. Filter for "like" opinions only
3. Extract post references from opinions
4. Fetch the actual posts
5. Add to feed with deduplication

### Replies Feed

**Purpose**: Shows replies to the user's own posts

**Key Features**:
- **State Machine**: Walks through user's posts one at a time
- **Pointer Tracking**: Prevents duplicate subscriptions
- **Aggregation**: Combines replies from multiple posts
- **Deduplication**: Uses pointer hashes to prevent duplicates

**State Machine Implementation**:
```typescript
// State machine to walk forward through the user's posts, one at a time
const [currentPointerIndex, setCurrentPointerIndex] = useState(0);

// Compute the pointer for the post we're currently focusing on
const currentPostPointer = useMemo(() => {
  if (currentPointerIndex >= posts.length) return undefined;
  return Models.signedEventToPointer(posts[currentPointerIndex].signedEvent);
}, [posts, currentPointerIndex]);
```

**Processing Flow**:
1. Load user's own posts in batches
2. For each post, find replies referencing it
3. Move to next post when current post's replies are exhausted
4. Aggregate all replies with deduplication
5. Sort by timestamp

## Data Flow

### 1. Initialization
```
User Action → Feed Hook → Query Manager → Process Handle → Store
```

### 2. Data Loading
```
Store → CRDT Query → Event Processing → Content Parsing → Feed Items
```

### 3. Real-time Updates
```
Network Event → CRDT Update → Hook Re-render → UI Update
```

### 4. Pagination
```
User Scroll → Advance Function → Next Batch → Append to Feed
```

## Performance Optimizations

### 1. Content Type Separation
- **Problem**: Mixed content types can cause unnecessary re-renders
- **Solution**: Separate hooks for each content type
- **Benefit**: Independent synchronization and loading states

### 2. Moderation Filtering
- **Problem**: Processing blocked content wastes resources
- **Solution**: Filter at query level, not display level
- **Benefit**: Reduces unnecessary data processing

### 3. Race Condition Prevention
- **Problem**: Concurrent operations can cause data corruption
- **Solution**: AsyncLock for critical sections
- **Benefit**: Ensures data consistency during concurrent access

### 4. Cursor-based Pagination
- **Problem**: Offset-based pagination becomes slow with large datasets
- **Solution**: Cursor-based pagination with stable cursors
- **Benefit**: Consistent performance regardless of data size

### 5. Memoization
- **Problem**: Expensive computations on every render
- **Solution**: useMemo for filtered data and derived state
- **Benefit**: Prevents unnecessary recalculations

## Error Handling

### 1. Malformed References
```typescript
try {
  pointer = Models.Pointer.fromProto(Protocol.Pointer.decode(reference));
} catch (err) {
  console.warn('Skipping invalid pointer:', err);
  return; // Graceful degradation
}
```

### 2. Content Decoding Errors
```typescript
try {
  const post = Protocol.Post.decode(event.content);
  // Process post...
} catch (decodeError) {
  console.error('Failed to decode post content:', decodeError);
  return; // Skip malformed content
}
```

### 3. Network Failures
- CancelContext prevents stale updates
- Graceful degradation when servers are unavailable
- Retry logic in query managers

### 4. Memory Management
- Automatic cleanup of event listeners
- CancelContext prevents memory leaks
- Proper cleanup in useEffect return functions

## Conclusion

The Polycentric React feed system is a sophisticated architecture that handles real-time, distributed content synchronization with excellent performance characteristics. The system's design emphasizes:

- **Separation of Concerns**: Each feed type has a specific purpose and implementation
- **Performance**: Optimized for large datasets with efficient pagination and filtering
- **Reliability**: Comprehensive error handling and race condition prevention
- **Real-time**: Live updates through CRDT synchronization
- **User Experience**: Smooth infinite scroll with proper loading states

This architecture enables the Polycentric platform to handle complex social media interactions while maintaining data consistency and performance across distributed systems.
