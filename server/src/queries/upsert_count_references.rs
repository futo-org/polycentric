use std::collections::HashMap;

pub(crate) enum Operation {
    Increment,
    Decrement,
}

#[derive(Eq, Hash, PartialEq)]
struct BytesKey {
    content_type: u64,
    subject_bytes: Vec<u8>,
}

pub(crate) struct BytesBatch {
    counts: HashMap<BytesKey, i64>,
}

impl BytesBatch {
    pub(crate) fn new() -> BytesBatch {
        BytesBatch {
            counts: HashMap::new(),
        }
    }

    pub(crate) fn append(
        &mut self,
        content_type: u64,
        subject_bytes: Vec<u8>,
        operation: Operation,
    ) {
        *self
            .counts
            .entry(BytesKey {
                content_type,
                subject_bytes: subject_bytes.clone(),
            })
            .or_insert(0) += match operation {
            Operation::Increment => 1,
            Operation::Decrement => -1,
        }
    }
}
