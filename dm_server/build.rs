use protobuf_codegen::Codegen;

fn main() {
    Codegen::new()
        .protoc()
        .protoc_path(&protoc_bin_vendored::protoc_bin_path().unwrap())
        .includes(&["../proto"])
        .input("../proto/protocol.proto")
        .input("../proto/dm_protocol.proto")
        .cargo_out_dir("protos")
        .run_from_script();
}
