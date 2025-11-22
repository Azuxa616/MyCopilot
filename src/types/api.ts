export enum ApiStatusCode {
  SUCCESS = 200,
  NOT_FOUND = 404,
  SERVER_ERROR = 500,
}

export interface ApiResponse<T> {
  code: ApiStatusCode | number;
  msg: string;
  data: T;
}

