import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ProfileBusyError } from '../profiles/lock.service';
import {
  ProfileNotFoundError,
  ProfileRunningError,
} from '../profiles/profile.service';

@Catch(ProfileNotFoundError, ProfileRunningError, ProfileBusyError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(err: Error, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (err instanceof ProfileNotFoundError) status = HttpStatus.NOT_FOUND;
    else if (err instanceof ProfileRunningError || err instanceof ProfileBusyError)
      status = HttpStatus.CONFLICT;
    res.status(status).json(new HttpException(err.message, status).getResponse());
  }
}
