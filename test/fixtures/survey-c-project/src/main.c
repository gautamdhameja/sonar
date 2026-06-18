#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: copier <input> <output>\n");
    return 1;
  }

  FILE *input = fopen(argv[1], "rb");
  if (!input) {
    fprintf(stderr, "unable to read input: %s\n", strerror(errno));
    return 2;
  }

  FILE *output = fopen(argv[2], "wb");
  if (!output) {
    fclose(input);
    fprintf(stderr, "unable to open output: %s\n", strerror(errno));
    return 3;
  }

  char buffer[4096];
  size_t read_count = 0;
  while ((read_count = fread(buffer, 1, sizeof(buffer), input)) > 0) {
    fwrite(buffer, 1, read_count, output);
  }

  fclose(input);
  fclose(output);
  return 0;
}
