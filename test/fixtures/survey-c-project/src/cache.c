#include <stdio.h>

void remember_last_run(const char *path) {
  FILE *state = fopen(path, "a");
  if (state) {
    fprintf(state, "completed\n");
    fclose(state);
  }
}
