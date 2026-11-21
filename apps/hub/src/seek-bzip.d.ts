// Types minimaux de seek-bzip (décompression bzip2 en JavaScript pur).
declare module "seek-bzip" {
  const Bunzip: { decode(input: Buffer, output?: Buffer | null, multistream?: boolean): Buffer };
  export default Bunzip;
}
