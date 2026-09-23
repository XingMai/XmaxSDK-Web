export interface RemoteStreamInit {
  /**
   * 远端流所在房间号。
   */
  roomID: string;

  /**
   * 远端流所属用户标识。
   */
  userID: string;
}

/**
 * 标识 RTC 房间中的一条远端主流。
 */
export class RemoteStream {
  /**
   * 流标识
   */
  /**
   * 远端流所在房间号。
   */
  readonly roomID: string;

  /**
   * 远端流所属用户标识。
   */
  readonly userID: string;

  /**
   * 创建远端流标识。
   *
   * @param init.roomID 远端流所在房间号。
   * @param init.userID 远端流所属用户标识。
   */
  constructor(init: RemoteStreamInit) {
    this.roomID = init.roomID;
    this.userID = init.userID;
  }

  /**
   * 跨房间唯一的远端流键。
   */
  get key(): string {
    return `${this.roomID}:${this.userID}`;
  }
}
