import { useEffect, useState } from 'react';

type InfiniteMap = {
  [key: string]: InfiniteMap | Record<string, never>;
};

const getRelevantTopics = (
  query: string,
  topics: InfiniteMap,
  out: InfiniteMap = {},
): void => {
  // Find all branches on the tree and below that matches the query
  // Ex. /tpot/dating => tpot: {  dating: { foo: {}}, },

  const [root, rest] = query.split('/');
  const matchingBranches = Object.keys(topics).filter((t) =>
    t.startsWith(root),
  );

  matchingBranches.forEach((branchName) => {
    if (rest == null) {
      // If we've reached the end of the query, return the rest of the branch as it's all matched by the query
      out[branchName] = topics[branchName];
    } else {
      // If not, continue recursively
      out[branchName] = {};
      getRelevantTopics(rest, topics[branchName], out[branchName]);
    }
  });
};

const TopicSuggestionBoxPill = ({
  topics,
  path,
  setSelected,
}: {
  topics: InfiniteMap;
  path: string;
  setSelected: (s: string) => void;
}) => (
  <>
    {Object.keys(topics).map((topic) => {
      const newPath = `${path}/${topic}`;
      return (
        <div key={newPath}>
          <button
            className="w-full hover:bg-gray-100 rounded-lg"
            // onMouseDown is used instead of onClick because onClick is triggered after onBlur,
            // which causes the suggestion box to close before the click is registered
            onMouseDown={() => {
              setSelected(newPath);
            }}
          >
            <div className="flex">
              <div className="bg-blue-500 -skew-x-6 px-1.5 py-1 my-0.5 rounded-lg">
                <div className="skew-x-6 text-white font-mono font-light text-md">
                  {topic}
                </div>
              </div>
              <div />
            </div>
          </button>
          <div className="ml-12">
            <TopicSuggestionBoxPill
              topics={topics[topic]}
              path={newPath}
              setSelected={setSelected}
            />
          </div>
        </div>
      );
    })}
  </>
);

export const TopicSuggestionBox = ({
  topics,
  query,
  setSelected,
}: {
  topics: InfiniteMap;
  query: string;
  setSelected: (s: string) => void;
}) => {
  // Depth first search
  const [results, setResults] = useState<InfiniteMap>({});
  useEffect(() => {
    const out: InfiniteMap = {};
    // take out the first slash
    const firstSlashlessQuery = query.slice(1);
    if (firstSlashlessQuery === '') {
      setResults({});
      return;
    }
    getRelevantTopics(firstSlashlessQuery, topics, out);
    setResults(out);
  }, [query, topics]);

  return (
    <div className="bg-white p-5 rounded-b-xl border border-gray-400 w-full">
      <TopicSuggestionBoxPill
        topics={results}
        path=""
        setSelected={setSelected}
      />
    </div>
  );
};
