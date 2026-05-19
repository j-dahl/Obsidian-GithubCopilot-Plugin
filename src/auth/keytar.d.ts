declare module "keytar" {
  export function findCredentials(
    service: string
  ): Promise<Array<{ account: string; password: string }>>;
}
