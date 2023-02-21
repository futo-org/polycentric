extern crate protobuf_codegen;
extern crate protoc_bin_vendored;

fn main() {
    protobuf_codegen::Codegen::new()
        .protoc()
        .protoc_path(&protoc_bin_vendored::protoc_bin_path().unwrap())
        .includes(&["../proto"])
        .input("../proto/protocol.proto")
        .cargo_out_dir("protos")
        .run_from_script();
}
