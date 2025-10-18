import { sparseService } from '../../src/fetchr/base/service_injection/global';

const text = 'This is a test sentence.';
const sparseVector = await sparseService.getSparseVector(text, 'passage');
console.log(sparseVector);
