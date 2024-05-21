pub(crate) struct BytesBatch {
    p_event_id: Vec<i64>,
    p_system_key_type: Vec<i64>,
    p_system_key: Vec<Vec<u8>>,
    p_process: Vec<Vec<u8>>,
    p_content_type: Vec<i64>,
    p_lww_element_unix_milliseconds: Vec<i64>,
    p_subject: Vec<Vec<u8>>,
}


impl BytesBatch {
    pub(crate) fn new() -> BytesBatch {
        BytesBatch {
            p_event_id: vec![],
            p_system_key_type: vec![],
            p_system_key: vec![],
            p_process: vec![],
            p_content_type: vec![],
            p_lww_element_unix_milliseconds: vec![],
            p_subject: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        event_pointer: &crate::model::InsecurePointer,
        content_type: u64,
        lww_element: &crate::protocol::LWWElement,
        subject: Vec<u8>,
    ) -> ::anyhow::Result<()> {
        self.p_event_id.push(event_id);

        Ok(())
    }
}

pub(crate) struct PointerBatch {
    p_event_id: Vec<i64>,
    p_system_key_type: Vec<i64>,
    p_system_key: Vec<Vec<u8>>,
    p_process: Vec<Vec<u8>>,
    p_content_type: Vec<i64>,
    p_lww_element_unix_milliseconds: Vec<i64>,
    p_subject_system_key_type: Vec<i64>,
    p_subject_system_key: Vec<Vec<u8>>,
    p_subject_process: Vec<Vec<u8>>,
    p_subject_logical_clock: Vec<i64>,
}

impl PointerBatch {
    pub(crate) fn new() -> PointerBatch {
        PointerBatch {
            p_event_id: vec![],
            p_system_key_type: vec![],
            p_system_key: vec![],
            p_process: vec![],
            p_content_type: vec![],
            p_lww_element_unix_milliseconds: vec![],
            p_subject_system_key_type: vec![],
            p_subject_system_key: vec![],
            p_subject_process: vec![],
            p_subject_logical_clock: vec![],
        }
    }

    pub(crate) fn append(
        &mut self,
        event_id: i64,
        event_pointer: &crate::model::InsecurePointer,
        content_type: u64,
        lww_element: &crate::protocol::LWWElement,
        subject: &crate::model::pointer::Pointer,
    ) -> ::anyhow::Result<()> {
        self.p_event_id.push(event_id);

        Ok(())
    }
}

